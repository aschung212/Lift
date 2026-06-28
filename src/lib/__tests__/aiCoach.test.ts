import { describe, it, expect } from 'vitest'
import {
  validateCoachPayload,
  sanitizeCoachOutput,
  costCents,
  estimateMaxCostCents,
  containsUrl,
  MAX_OUTPUT_TOKENS,
  MAX_PROGRESS_ITEMS,
  type CoachPayload,
} from '../aiCoach'

function validPayload(): CoachPayload {
  return {
    unit: 'lb',
    progress: [{ exerciseName: 'Bench Press', e1rmNow: 225, e1rmDelta: 10, isPR: true }],
    volume: [{ tagName: 'Chest', weeklyVolume: 12000 }],
    consistency: { workoutDaysThisWeek: 4, weeklyTarget: 4, streakWeeks: 6, goalMet: true },
    focus: [],
    bodyweight: null,
  }
}

describe('validateCoachPayload', () => {
  it('accepts a well-formed payload with >= 2 non-null sections', () => {
    const r = validateCoachPayload(validPayload())
    expect(r.ok).toBe(true)
  })

  it('rejects fewer than 2 non-null sections (insufficient signal)', () => {
    const r = validateCoachPayload({
      unit: 'lb',
      progress: [{ exerciseName: 'Bench', e1rmNow: 200, e1rmDelta: 5, isPR: false }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(422)
      expect(r.error).toBe('insufficient_signal')
    }
  })

  it('rejects unexpected top-level fields (allowlist)', () => {
    const r = validateCoachPayload({ ...validPayload(), rawSets: [1, 2, 3] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('unexpected_field')
  })

  it('rejects too many progress items', () => {
    const progress = Array.from({ length: MAX_PROGRESS_ITEMS + 1 }, (_, i) => ({
      exerciseName: `Ex${i}`,
      e1rmNow: 100,
      e1rmDelta: 1,
      isPR: false,
    }))
    const r = validateCoachPayload({ unit: 'lb', progress, volume: [{ tagName: 'X', weeklyVolume: 1 }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('progress_too_many')
  })

  it('truncates over-long exercise names and coerces unit', () => {
    const r = validateCoachPayload({
      unit: 'stone',
      progress: [{ exerciseName: 'x'.repeat(200), e1rmNow: 100, e1rmDelta: 1, isPR: false }],
      consistency: { workoutDaysThisWeek: 3, weeklyTarget: 3, streakWeeks: 1, goalMet: true },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.unit).toBe('lb')
      expect(r.payload.progress[0].exerciseName.length).toBe(40)
    }
  })

  it('rejects non-finite numbers', () => {
    const r = validateCoachPayload({
      unit: 'lb',
      progress: [{ exerciseName: 'Bench', e1rmNow: 'lots', e1rmDelta: 1, isPR: false }],
      volume: [{ tagName: 'X', weeklyVolume: 1 }],
    })
    expect(r.ok).toBe(false)
  })
})

describe('sanitizeCoachOutput', () => {
  const payload = validPayload()

  it('truncates section bodies to the cap', () => {
    const review = sanitizeCoachOutput(
      {
        headline: 'Solid week',
        focusNext: 'Keep pressing',
        sections: [{ type: 'progress', title: 'Bench', body: 'a'.repeat(500) }],
      },
      payload,
    )
    expect(review.sections[0].body.length).toBe(280)
  })

  it('drops sections whose body contains a URL or markdown link', () => {
    const review = sanitizeCoachOutput(
      {
        headline: 'Hi',
        focusNext: 'Onward',
        sections: [
          { type: 'progress', title: 'A', body: 'clean and grounded' },
          { type: 'volume', title: 'B', body: 'visit evil.com for more' },
          { type: 'focus', title: 'C', body: 'see [here](http://x.io)' },
        ],
      },
      payload,
    )
    expect(review.sections).toHaveLength(1)
    expect(review.sections[0].title).toBe('A')
  })

  it('keeps a metric that echoes a payload number and blanks one that does not', () => {
    const grounded = sanitizeCoachOutput(
      {
        headline: 'PR week',
        focusNext: 'Next',
        sections: [{ type: 'progress', title: 'Bench', body: 'New PR', metric: { label: 'e1RM', value: '225 lb' } }],
      },
      payload,
    )
    expect(grounded.sections[0].metric).toEqual({ label: 'e1RM', value: '225 lb' })

    const ungrounded = sanitizeCoachOutput(
      {
        headline: 'PR week',
        focusNext: 'Next',
        sections: [{ type: 'progress', title: 'Bench', body: 'New PR', metric: { label: 'e1RM', value: '999 lb' } }],
      },
      payload,
    )
    expect(ungrounded.sections[0].metric).toBeUndefined()
  })

  it('throws on structurally unusable output', () => {
    expect(() => sanitizeCoachOutput({ sections: [] }, payload)).toThrow()
    expect(() => sanitizeCoachOutput('nope', payload)).toThrow()
  })
})

describe('costCents', () => {
  it('prices Opus 4.8 at $5/$25 per 1M', () => {
    // 3000 input + 2500 output: 3000*500/1e6 + 2500*2500/1e6 = 1.5 + 6.25 = 7.75c -> ceil 8
    expect(costCents('claude-opus-4-8', 3000, 2500)).toBe(8)
  })

  it('prices Sonnet 4.6 cheaper than Opus', () => {
    expect(costCents('claude-sonnet-4-6', 3000, 2500)).toBeLessThan(costCents('claude-opus-4-8', 3000, 2500))
  })

  it('prices Haiku 4.5 at ~1c for a small request', () => {
    // 3000*100/1e6 + 1024*500/1e6 = 0.3 + 0.512 = 0.812c -> ceil 1
    expect(costCents('claude-haiku-4-5', 3000, 1024)).toBe(1)
  })

  it('throws on an unknown model rather than fabricating a price', () => {
    expect(() => costCents('claude-made-up-9', 1000, 1000)).toThrow(/unknown_model/)
  })

  it('estimateMaxCostCents uses the full output budget', () => {
    expect(estimateMaxCostCents('claude-opus-4-8', 3000)).toBe(costCents('claude-opus-4-8', 3000, MAX_OUTPUT_TOKENS))
  })
})

describe('containsUrl', () => {
  it('flags links and bare domains', () => {
    expect(containsUrl('http://x.com')).toBe(true)
    expect(containsUrl('go to spam.io now')).toBe(true)
    expect(containsUrl('[click](https://a.dev)')).toBe(true)
    expect(containsUrl('a clean coaching sentence with no links')).toBe(false)
  })
})
