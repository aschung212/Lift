import { describe, it, expect } from 'vitest'
import {
  DEFAULT_COACH_PROFILE,
  sanitizeCoachProfile,
  profileCompleteness,
  isProfileEmpty,
  buildAthleteBlock,
  PROFILE_VERSION,
  type CoachProfile,
} from '../coachProfile'

function make(overrides: Partial<CoachProfile> = {}): CoachProfile {
  return { ...DEFAULT_COACH_PROFILE, competition: { ...DEFAULT_COACH_PROFILE.competition }, ...overrides }
}

describe('coachProfile — sanitize', () => {
  it('coerces a corrupt/partial blob to defaults field-by-field, never throwing', () => {
    const p = sanitizeCoachProfile({ sex: 'martian', age: 999, daysPerWeek: 'lots', reviewMode: 'nope' })
    expect(p.sex).toBe('')
    expect(p.age).toBeNull()
    expect(p.daysPerWeek).toBeNull()
    expect(p.reviewMode).toBe('deep_audit')
    expect(p.version).toBe(PROFILE_VERSION)
  })

  it('keeps valid values and clamps numbers to range', () => {
    const p = sanitizeCoachProfile({
      sex: 'male',
      age: 31,
      height: "5'6\"",
      experience: 'advanced',
      primaryGoal: 'hypertrophy',
      daysPerWeek: 4,
      sessionLenMin: 75,
      equipment: 'full_gym',
      reviewMode: 'quick_checkin',
    })
    expect(p).toMatchObject({
      sex: 'male',
      age: 31,
      experience: 'advanced',
      primaryGoal: 'hypertrophy',
      daysPerWeek: 4,
      sessionLenMin: 75,
      equipment: 'full_gym',
      reviewMode: 'quick_checkin',
    })
  })

  it('rejects out-of-range numbers (age 5, 200 days/week)', () => {
    expect(sanitizeCoachProfile({ age: 5 }).age).toBeNull()
    expect(sanitizeCoachProfile({ daysPerWeek: 200 }).daysPerWeek).toBeNull()
  })

  it('trims and caps free-text fields', () => {
    const long = 'x'.repeat(5000)
    expect(sanitizeCoachProfile({ injuries: '  bad shoulder  ' }).injuries).toBe('bad shoulder')
    expect(sanitizeCoachProfile({ prioritiesLagging: long }).prioritiesLagging.length).toBeLessThanOrEqual(400)
  })

  it('sanitizes nested competition', () => {
    const p = sanitizeCoachProfile({ competing: true, competition: { sport: 'bodybuilding', division: 'Classic' } })
    expect(p.competing).toBe(true)
    expect(p.competition.sport).toBe('bodybuilding')
    expect(p.competition.division).toBe('Classic')
    expect(p.competition.phase).toBe('')
  })
})

describe('coachProfile — completeness', () => {
  it('reports 0 for a default profile and flags it empty', () => {
    const c = profileCompleteness(DEFAULT_COACH_PROFILE)
    expect(c.filled).toBe(0)
    expect(isProfileEmpty(DEFAULT_COACH_PROFILE)).toBe(true)
  })

  it('counts filled core fields and competition once', () => {
    const p = make({ sex: 'male', age: 31, experience: 'advanced', competing: true, competition: { sport: 'bb', division: '', timeline: '', phase: '' } })
    const c = profileCompleteness(p)
    expect(c.filled).toBe(4) // sex, age, experience, competition
    expect(c.total).toBeGreaterThan(c.filled)
    expect(isProfileEmpty(p)).toBe(false)
  })
})

describe('coachProfile — buildAthleteBlock', () => {
  it('returns an athlete block that omits empty fields', () => {
    const p = make({ sex: 'male', age: 31, primaryGoal: 'hypertrophy' })
    const block = buildAthleteBlock(p)
    expect(block).toContain('<athlete>')
    expect(block).toContain('</athlete>')
    const json = JSON.parse(block.replace('<athlete>', '').replace('</athlete>', '').trim())
    expect(json).toMatchObject({ sex: 'male', age: 31, primary_goal: 'hypertrophy', review_mode: 'deep_audit' })
    // Untouched fields are absent, not null/empty.
    expect(json).not.toHaveProperty('injuries')
    expect(json).not.toHaveProperty('height')
  })

  it('nests schedule and competition, and always carries review_mode', () => {
    const p = make({
      daysPerWeek: 4,
      sessionLenMin: 75,
      competing: true,
      competition: { sport: 'natural bodybuilding', division: "Men's Physique", timeline: 'next year', phase: 'offseason' },
      reviewMode: 'quick_checkin',
    })
    const json = JSON.parse(buildAthleteBlock(p).replace(/<\/?athlete>/g, '').trim())
    expect(json.schedule).toEqual({ days_per_week: 4, session_len_min: 75 })
    expect(json.competition).toMatchObject({ sport: 'natural bodybuilding', divisions: "Men's Physique", phase: 'offseason' })
    expect(json.review_mode).toBe('quick_checkin')
  })

  it('drops competition when not competing even if fields linger', () => {
    const p = make({ competing: false, competition: { sport: 'bb', division: 'x', timeline: '', phase: '' } })
    const json = JSON.parse(buildAthleteBlock(p).replace(/<\/?athlete>/g, '').trim())
    expect(json).not.toHaveProperty('competition')
  })
})
