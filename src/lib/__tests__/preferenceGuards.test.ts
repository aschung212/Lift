/**
 * LIFT-1493 — the three preferences-blob sub-objects that used to be spread onto
 * state raw.
 *
 * Each corrupt case below is stated in the shape it actually arrives in: a value
 * that got into `user_preferences.preferences` (a jsonb blob with no schema) or
 * into the `user-preferences` localStorage key (user-writable). The point of
 * every assertion is the same — the corrupt value must not reach state, because
 * whatever reaches state is re-persisted by `_persistLocal` and pushed back by
 * `_persist`, so the blob launders itself onto every device.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sanitizeFeatureFlags,
  sanitizeExperienceFlags,
  sanitizeFilterSettings,
  clampWarmupThreshold,
  DEFAULT_FEATURES,
  DEFAULT_EXPERIENCE,
  DEFAULT_FILTERS,
  MIN_WARMUP_THRESHOLD,
  MAX_WARMUP_THRESHOLD,
} from '../preferenceGuards'

describe('preferenceGuards (LIFT-1493)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  describe('sanitizeFeatureFlags', () => {
    it('keeps a well-formed map', () => {
      expect(sanitizeFeatureFlags({ workouts: true, calendar: false, weight: true }))
        .toEqual({ workouts: true, calendar: false, weight: true })
    })

    it('fills missing keys from the defaults', () => {
      expect(sanitizeFeatureFlags({ calendar: false }))
        .toEqual({ workouts: true, calendar: false, weight: true })
    })

    it('rejects a string outright rather than spreading it into index keys', () => {
      // The headline failure: `{ ...DEFAULTS, ...'abc' }` is
      // `{ workouts, calendar, weight, 0: 'a', 1: 'b', 2: 'c' }`, and
      // `enabledCount` counts Object.values(...).filter(Boolean) — so the
      // "can't disable your last tab" guard reads 6 where there are 3.
      const out = sanitizeFeatureFlags('abc')
      expect(out).toEqual(DEFAULT_FEATURES)
      expect(Object.keys(out)).toEqual(['workouts', 'calendar', 'weight'])
    })

    it('rejects an array, which spreads into index keys the same way', () => {
      expect(sanitizeFeatureFlags([true, false])).toEqual(DEFAULT_FEATURES)
    })

    it('rejects null and undefined', () => {
      expect(sanitizeFeatureFlags(null)).toEqual(DEFAULT_FEATURES)
      expect(sanitizeFeatureFlags(undefined)).toEqual(DEFAULT_FEATURES)
    })

    it('drops a non-boolean value and falls back to that key\'s default', () => {
      // 'false' is truthy — a stringified flag would read as ON.
      expect(sanitizeFeatureFlags({ workouts: 'false', calendar: 0, weight: false }))
        .toEqual({ workouts: true, calendar: true, weight: false })
    })

    it('keeps an unknown BOOLEAN key so a newer client\'s flag round-trips', () => {
      // FeatureFlags declares an index signature; stripping an unrecognized
      // flag here would push it back to the server as a deletion.
      expect(sanitizeFeatureFlags({ workouts: true, someFutureTab: false }))
        .toEqual({ workouts: true, calendar: true, weight: true, someFutureTab: false })
    })

    it('returns a fresh object, never the defaults themselves', () => {
      const out = sanitizeFeatureFlags({ workouts: false })
      expect(out).not.toBe(DEFAULT_FEATURES)
      expect(DEFAULT_FEATURES.workouts).toBe(true)
    })
  })

  describe('sanitizeExperienceFlags', () => {
    it('keeps well-formed flags', () => {
      expect(sanitizeExperienceFlags({
        prCelebrations: false, haptics: false, screenWakeLock: true, restTimerNotification: false,
      })).toEqual({
        prCelebrations: false, haptics: false, screenWakeLock: true, restTimerNotification: false,
      })
    })

    it('reads a stringified opt-out as the DEFAULT, not as truthy', () => {
      // `'false'` is truthy, so the raw spread turned an opt-out into an opt-in
      // at every consumer — the direction of the mistake a user notices.
      expect(sanitizeExperienceFlags({ prCelebrations: 'false', haptics: 'false' }))
        .toEqual(DEFAULT_EXPERIENCE)
    })

    it('falls back to defaults on a non-object', () => {
      expect(sanitizeExperienceFlags('nope')).toEqual(DEFAULT_EXPERIENCE)
      expect(sanitizeExperienceFlags([false])).toEqual(DEFAULT_EXPERIENCE)
      expect(sanitizeExperienceFlags(null)).toEqual(DEFAULT_EXPERIENCE)
    })

    it('drops unknown keys (the interface declares no index signature)', () => {
      const out = sanitizeExperienceFlags({ haptics: false, bogus: true })
      expect(out).toEqual({ ...DEFAULT_EXPERIENCE, haptics: false })
      expect('bogus' in out).toBe(false)
    })
  })

  describe('sanitizeFilterSettings', () => {
    it('keeps an in-range threshold', () => {
      expect(sanitizeFilterSettings({ warmupThreshold: 0.6 })).toEqual({ warmupThreshold: 0.6 })
    })

    it('rejects a stringified number rather than letting NaN reach the comparison', () => {
      // `'0.75' * 100` is fine, but `ratio < '0.75'` coerces per-comparison and
      // `Math.round(t * 100)` renders "NaN%" for anything non-numeric — warmup
      // classification silently stops happening either way.
      expect(sanitizeFilterSettings({ warmupThreshold: '0.75' })).toEqual(DEFAULT_FILTERS)
    })

    it('rejects NaN and Infinity, which ARE numbers', () => {
      expect(sanitizeFilterSettings({ warmupThreshold: NaN })).toEqual(DEFAULT_FILTERS)
      expect(sanitizeFilterSettings({ warmupThreshold: Infinity })).toEqual(DEFAULT_FILTERS)
    })

    it('clamps an out-of-range threshold to the setter\'s own bounds', () => {
      expect(sanitizeFilterSettings({ warmupThreshold: 0 }).warmupThreshold).toBe(MIN_WARMUP_THRESHOLD)
      expect(sanitizeFilterSettings({ warmupThreshold: 9 }).warmupThreshold).toBe(MAX_WARMUP_THRESHOLD)
    })

    it('falls back to defaults on a non-object', () => {
      expect(sanitizeFilterSettings('0.75')).toEqual(DEFAULT_FILTERS)
      expect(sanitizeFilterSettings(null)).toEqual(DEFAULT_FILTERS)
    })
  })

  describe('clampWarmupThreshold', () => {
    it('is the one definition of the bounds the store setter uses', () => {
      expect(clampWarmupThreshold(0.1)).toBe(MIN_WARMUP_THRESHOLD)
      expect(clampWarmupThreshold(0.99)).toBe(MAX_WARMUP_THRESHOLD)
      expect(clampWarmupThreshold(0.75)).toBe(0.75)
    })

    it('leaves the default inside its own bounds', () => {
      expect(clampWarmupThreshold(DEFAULT_FILTERS.warmupThreshold)).toBe(DEFAULT_FILTERS.warmupThreshold)
    })
  })
})
