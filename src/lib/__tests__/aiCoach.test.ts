import { describe, it, expect } from 'vitest'
import {
  validateCoachPayload,
  sanitizeCoachOutput,
  costCents,
  estimateMaxCostCents,
  containsUrl,
  MAX_OUTPUT_TOKENS,
  MAX_SETS,
  MIN_SETS_FOR_REVIEW,
  type CoachPayload,
  type SetRecord,
} from '../aiCoach'

function makeSets(n: number): SetRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    exerciseName: 'Bench Press',
    weight: 225,
    reps: 5,
    e1rm: 253,
    date: '2026-06-17',
    intensityPct: 89,
    isPR: i === 0,
  }))
}

function validPayload(): CoachPayload {
  return {
    unit: 'lb',
    sets: makeSets(MIN_SETS_FOR_REVIEW),
    personalRecords: [{ exerciseName: 'Bench Press', bestE1rm: 253, bestWeight: 245, bestReps: 1 }],
    volume: [{ tagName: 'Chest', weeklyVolume: 12000 }],
    consistency: { workoutDaysThisWeek: 4, weeklyTarget: 4, streakWeeks: 6, goalMet: true },
    focus: [],
    bodyweight: null,
    sessions: [{ date: '2026-06-17', tags: ['Chest'], setCount: 8 }],
  }
}

describe('validateCoachPayload', () => {
  it('accepts a well-formed payload with the full set log', () => {
    const r = validateCoachPayload(validPayload())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.sets).toHaveLength(MIN_SETS_FOR_REVIEW)
      expect(r.payload.sets[0].intensityPct).toBe(89)
    }
  })

  it('rejects too few sets (insufficient signal)', () => {
    const r = validateCoachPayload({ ...validPayload(), sets: makeSets(MIN_SETS_FOR_REVIEW - 1) })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(422)
      expect(r.error).toBe('insufficient_signal')
    }
  })

  it('rejects unexpected top-level fields (allowlist)', () => {
    const r = validateCoachPayload({ ...validPayload(), email: 'a@b.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('unexpected_field')
  })

  it('rejects more than MAX_SETS with 413', () => {
    const r = validateCoachPayload({ ...validPayload(), sets: makeSets(MAX_SETS + 1) })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(413)
      expect(r.error).toBe('too_many_sets')
    }
  })

  it('truncates over-long exercise names and coerces unit', () => {
    const sets = makeSets(MIN_SETS_FOR_REVIEW).map((s) => ({ ...s, exerciseName: 'x'.repeat(200) }))
    const r = validateCoachPayload({ ...validPayload(), unit: 'stone', sets })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.unit).toBe('lb')
      expect(r.payload.sets[0].exerciseName.length).toBe(40)
    }
  })

  it('rejects non-finite numeric fields in a set', () => {
    const sets = makeSets(MIN_SETS_FOR_REVIEW)
    sets[0] = { ...sets[0], weight: Number.NaN }
    const r = validateCoachPayload({ ...validPayload(), sets })
    expect(r.ok).toBe(false)
  })

  it('accepts sets with only the required fields (optional fields omitted)', () => {
    const sets: SetRecord[] = Array.from({ length: MIN_SETS_FOR_REVIEW }, () => ({
      exerciseName: 'Squat',
      weight: 315,
      reps: 3,
    }))
    const r = validateCoachPayload({ unit: 'lb', sets })
    expect(r.ok).toBe(true)
  })

  it('accepts a sessions list and per-set timeOfDay', () => {
    const sets = makeSets(MIN_SETS_FOR_REVIEW).map((s) => ({ ...s, timeOfDay: '17:30' }))
    const r = validateCoachPayload({
      ...validPayload(),
      sets,
      sessions: [{ date: '2026-06-17', tags: ['Chest', 'Push'], setCount: 8 }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.sessions[0]).toEqual({ date: '2026-06-17', tags: ['Chest', 'Push'], setCount: 8 })
      expect(r.payload.sets[0].timeOfDay).toBe('17:30')
    }
  })

  it('rejects a malformed session entry', () => {
    const r = validateCoachPayload({ ...validPayload(), sessions: [{ date: '2026-06-17', tags: 'Chest', setCount: 3 }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('session_invalid')
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
        sections: [{ type: 'progress', title: 'Bench', body: 'New PR', metric: { label: 'top set', value: '225 lb' } }],
      },
      payload,
    )
    expect(grounded.sections[0].metric).toEqual({ label: 'top set', value: '225 lb' })

    const ungrounded = sanitizeCoachOutput(
      {
        headline: 'PR week',
        focusNext: 'Next',
        sections: [{ type: 'progress', title: 'Bench', body: 'New PR', metric: { label: 'top set', value: '999 lb' } }],
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

  it('scales with a larger (full-history) input payload', () => {
    // 30000 input + 2500 output on Opus: 15 + 6.25 = 21.25c -> 22
    expect(costCents('claude-opus-4-8', 30000, 2500)).toBe(22)
  })

  it('prices Sonnet 4.6 cheaper than Opus', () => {
    expect(costCents('claude-sonnet-4-6', 3000, 2500)).toBeLessThan(costCents('claude-opus-4-8', 3000, 2500))
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
