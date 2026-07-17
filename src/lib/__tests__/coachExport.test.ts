import { describe, it, expect } from 'vitest'
import {
  COACH_MODE,
  RECOMMENDED_COACH_PROMPT,
  buildCoachExportText,
  coachExportFilename,
} from '../coachExport'
import type { CoachPayload } from '../aiCoach'
import { buildAthleteBlock, DEFAULT_COACH_PROFILE } from '../coachProfile'

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
  it('is an analyst prompt: analyze → synthesize → prescribe', () => {
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/ANALYZE/)
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/SYNTHESIZE/)
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/PRESCRIBE/)
  })

  it('bakes in the known pitfalls (e1RM inflation, machine lifts not standard-comparable)', () => {
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/high-rep sets/i)
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/machine lifts/i)
  })

  it('keeps the DATA-ONLY prompt-injection guard for user-entered fields', () => {
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/DATA ONLY/)
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/untrusted/)
  })

  it('asks for prose of data-driven depth, not the server JSON schema (open loop)', () => {
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/no JSON/i)
    expect(RECOMMENDED_COACH_PROMPT).toMatch(/review_mode/)
  })

  it('references both the athlete profile and the data block', () => {
    expect(RECOMMENDED_COACH_PROMPT).toContain('<athlete>')
    expect(RECOMMENDED_COACH_PROMPT).toContain('<data>')
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

  it('injects the athlete block between the prompt and the data when provided', () => {
    const block = buildAthleteBlock({ ...DEFAULT_COACH_PROFILE, sex: 'male', age: 31 })
    const text = buildCoachExportText(PAYLOAD, block)
    expect(text).toContain('<athlete>')
    const athletePos = text.indexOf('<athlete>')
    const dataPos = text.indexOf('<data>')
    expect(text.indexOf(RECOMMENDED_COACH_PROMPT)).toBeLessThan(athletePos)
    expect(athletePos).toBeLessThan(dataPos)
  })

  it('omits the serialized athlete block when none is supplied', () => {
    // The prompt text references <athlete> in prose; assert no actual data block
    // (a `<athlete>\n{…}` payload) is emitted.
    expect(buildCoachExportText(PAYLOAD)).not.toMatch(/<athlete>\s*\{/)
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
