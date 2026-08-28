import { describe, it, expect } from 'vitest'
import { hashUserId, buildJsonExport, buildCsvExport, csvEscape } from '../dataExport'

const metadata = {
  exportDate: '2026-04-05T12:00:00.000Z',
  appVersion: '1.0.0',
  userIdHash: 'abc123',
}

const exercises = [
  {
    id: '1',
    name: 'Bench Press',
    tags: ['chest', 'push'],
    sets: [
      { id: 's1', date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
    ],
  },
]

const bodyweight = [
  { id: 'bw1', date: '2026-04-05T08:00:00.000Z', weight: 185 },
]

const progression = {
  totalXP: 5000,
  epoch: 1,
  streakWeeks: 3,
  weeklyTarget: 4,
  starterTheme: 'fire' as const,
  unlockedThemes: [],
  xpPerSet: {},
}

describe('dataExport', () => {
  describe('hashUserId', () => {
    it('returns a 64-character hex string for a valid input', async () => {
      const hash = await hashUserId('test-user-id')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns deterministic output for the same input', async () => {
      const a = await hashUserId('same-id')
      const b = await hashUserId('same-id')
      expect(a).toBe(b)
    })

    it('returns different hashes for different inputs', async () => {
      const a = await hashUserId('user-1')
      const b = await hashUserId('user-2')
      expect(a).not.toBe(b)
    })
  })

  describe('buildJsonExport', () => {
    it('includes appVersion and userIdHash in output', () => {
      const data = buildJsonExport(metadata, exercises, bodyweight, progression)
      expect(data.appVersion).toBe('1.0.0')
      expect(data.userIdHash).toBe('abc123')
    })

    it('labels the weight unit so re-imports never guess (LIFT-1215)', () => {
      const data = buildJsonExport(metadata, exercises, bodyweight, progression)
      expect(data.units).toBe('lbs')
    })

    it('includes exportDate in output', () => {
      const data = buildJsonExport(metadata, exercises, bodyweight, progression)
      expect(data.exportDate).toBe('2026-04-05T12:00:00.000Z')
    })

    it('serializes exercises with sets', () => {
      const data = buildJsonExport(metadata, exercises, bodyweight, progression)
      expect(data.exercises).toHaveLength(1)
      expect(data.exercises[0].name).toBe('Bench Press')
      expect(data.exercises[0].tags).toEqual(['chest', 'push'])
      expect(data.exercises[0].sets).toHaveLength(1)
      expect(data.exercises[0].sets[0].weight).toBe(225)
    })

    it('does not leak exercise or set IDs into export', () => {
      const data = buildJsonExport(metadata, exercises, bodyweight, progression)
      const json = JSON.stringify(data)
      expect(json).not.toContain('"id"')
    })

    it('includes bodyweight entries', () => {
      const data = buildJsonExport(metadata, exercises, bodyweight, progression)
      expect(data.bodyweight).toHaveLength(1)
      expect(data.bodyweight[0].weight).toBe(185)
    })

    it('includes progression snapshot', () => {
      const data = buildJsonExport(metadata, exercises, bodyweight, progression)
      expect(data.progression.totalXP).toBe(5000)
      expect(data.progression.starterTheme).toBe('fire')
    })
  })

  describe('buildCsvExport', () => {
    it('includes metadata comment header with version and user hash', () => {
      const csv = buildCsvExport(metadata, exercises, bodyweight)
      const lines = csv.split('\n')
      expect(lines[0]).toBe('# Lift Export — 2026-04-05 — v1.0.0 — abc123 — weights in lbs')
    })

    it('includes column header row', () => {
      const csv = buildCsvExport(metadata, exercises, bodyweight)
      const lines = csv.split('\n')
      expect(lines[1]).toBe('Exercise,Date,Weight (lbs),Reps,Estimated 1RM,Tags,RPE')
    })

    it('includes exercise set data rows', () => {
      const csv = buildCsvExport(metadata, exercises, bodyweight)
      const lines = csv.split('\n')
      expect(lines[2]).toBe('Bench Press,2026-04-05,225,5,253,chest;push,')
    })

    it('includes bodyweight section when entries exist', () => {
      const csv = buildCsvExport(metadata, exercises, bodyweight)
      expect(csv).toContain('Date,Body Weight (lbs)')
      expect(csv).toContain('2026-04-05,185')
    })

    it('omits bodyweight section when no entries', () => {
      const csv = buildCsvExport(metadata, exercises, [])
      expect(csv).not.toContain('Body Weight')
    })
  })

  describe('csvEscape', () => {
    it('returns plain strings unchanged', () => {
      expect(csvEscape('Bench Press')).toBe('Bench Press')
    })

    it('wraps strings with commas in quotes', () => {
      expect(csvEscape('chest,push')).toBe('"chest,push"')
    })

    it('escapes internal double quotes', () => {
      expect(csvEscape('12" curl')).toBe('"12"" curl"')
    })

    it('wraps strings with newlines', () => {
      expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
    })
  })
})
