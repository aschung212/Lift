import { describe, it, expect } from 'vitest'
import {
  COACH_MODE,
  RECOMMENDED_COACH_PROMPT,
  buildCoachExportText,
  coachExportFilename,
} from '../coachExport'
import { COACH_SYSTEM_PROMPT, type CoachPayload } from '../aiCoach'

const PAYLOAD: CoachPayload = {
  weightUnit: 'lb',
  windowDays: 112,
  sets: [
    { exercise: 'Bench Press', weightLbs: 185, reps: 5, e1rm: 208, date: '2026-07-01', intensityPct: 92, pr: true },
  ],
  sessions: [{ date: '2026-07-01', tags: ['chest'], setCount: 12 }],
  prs: [{ exercise: 'Bench Press', e1rm: 208, date: '2026-07-01' }],
  volumeByGroup: [{ group: 'chest', sets: 12 }],
  consistency: { sessions: 4, weeks: 1 },
  focus: [],
} as unknown as CoachPayload

describe('coachExport — recommended prompt', () => {
  it('reuses the server coaching guidance verbatim', () => {
    expect(RECOMMENDED_COACH_PROMPT).toContain(COACH_SYSTEM_PROMPT)
  })

  it('asks for readable prose, not the server JSON schema (open loop)', () => {
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/no JSON/i)
    expect(RECOMMENDED_COACH_PROMPT).toContain('Focus next')
  })
})

describe('coachExport — buildCoachExportText', () => {
  it('embeds the prompt and the delimited data block', () => {
    const text = buildCoachExportText(PAYLOAD)
    expect(text).toContain(RECOMMENDED_COACH_PROMPT)
    expect(text).toContain('<data>')
    expect(text).toContain('</data>')
    // The actual training data is serialized inside the block.
    expect(text).toContain('Bench Press')
  })

  it('puts the prompt before the data so a user can swap in their own', () => {
    const text = buildCoachExportText(PAYLOAD)
    expect(text.indexOf(RECOMMENDED_COACH_PROMPT)).toBeLessThan(text.indexOf('<data>'))
  })
})

describe('coachExport — coachExportFilename', () => {
  it('builds a dated markdown filename from a local date key', () => {
    expect(coachExportFilename('2026-07-10')).toBe('lift-weekly-review-2026-07-10.md')
  })

  it('falls back safely when handed a non-date-key string', () => {
    expect(coachExportFilename('not-a-date')).toBe('lift-weekly-review-review.md')
  })
})

describe('coachExport — mode switch', () => {
  it('defaults to the client-side bring-your-own transport', () => {
    expect(COACH_MODE).toBe('byo')
  })
})
