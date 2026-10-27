/**
 * LIFT-1495 — the preferences blob is read through ONE parser.
 *
 * The persisted payload is written in exactly one place, `_buildPayload`
 * (LIFT-1243), and was read back in two hand-written copies of the same field
 * list: `loadLocalSettings`, which hydrates the state factory (a local-only
 * guest never calls `init()`, and every launch reads it before `init()`
 * resolves, LIFT-1177), and `_applyPreferences`, which serves `bindUser`, the
 * cross-tab reload and the Supabase row (LIFT-1178). Both returned a
 * `Partial<PreferencesState>`, so they compiled clean whatever they disagreed
 * about: a synced preference added to `_buildPayload` and `_applyPreferences`
 * reached a signed-in user once `init()` resolved and silently hydrated its
 * default for a guest. Nothing would have caught that, because every test fed a
 * hand-picked handful of fields through whichever path it was about.
 *
 * Both paths now call `parsePreferencesPayload`. These tests take the field list
 * from `_buildPayload()` itself rather than restating it, so a field added there
 * is covered here without anyone remembering to add it. (Test files are outside
 * `vue-tsc`'s include, so a typed fixture could not do that job at compile
 * time; the checks below do it at test time instead.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { DEFAULT_COACH_PROFILE } from '../../lib/coachProfile'

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

import { usePreferencesStore, parsePreferencesPayload } from '../preferences'

const localStorageMock = getLocalStorageMock()

type Payload = Record<string, unknown>

/** What storage hands back: a plain copy with no shared references. */
function jsonRoundTrip(value: unknown): Payload {
  return JSON.parse(JSON.stringify(value))
}

/** The payload a store writes on a device with nothing persisted. */
function defaultPayload(): Payload {
  localStorageMock.clear()
  setActivePinia(createPinia())
  return jsonRoundTrip(usePreferencesStore()._buildPayload())
}

/**
 * Every field at a legal value OTHER than its default, so a path that skips a
 * field shows up as the default instead of agreeing by accident. The first test
 * fails until a field added to `_buildPayload` is given a value here.
 */
const CUSTOM: Payload = {
  features: { workouts: true, calendar: false, weight: true },
  weightGoal: { direction: 'maintain', loseTarget: 170, gainTarget: null, maintainMin: 175, maintainMax: 180 },
  experience: { prCelebrations: false, haptics: false, screenWakeLock: true, restTimerNotification: false },
  filters: { warmupThreshold: 0.6 },
  prBaselineDate: '2026-03-02',
  strengthBaselineMode: 'recent',
  recentBaselineWeeks: 12,
  theme: 'water',
  colorMode: 'light',
  weightUnit: 'kg',
  restTimerEnabled: false,
  restTimerAutoStart: false,
  appIcon: 'water',
  intensityPresets: [60, 75, 95],
  coachProfile: {
    ...DEFAULT_COACH_PROFILE,
    sex: 'female',
    age: 34,
    experience: 'advanced',
    primaryGoal: 'powerlifting',
    daysPerWeek: 4,
    equipment: 'home_gym',
    competing: true,
    competition: { sport: 'Powerlifting', division: 'Open', timeline: '12 weeks', phase: 'Peak' },
    reviewMode: 'quick_checkin',
  },
  gyms: ['Home', 'Downtown'],
}

/**
 * Every field at a value its guard must reject, each of which degrades to that
 * field's default. Held to the same rule as `CUSTOM`: one entry per field.
 */
const CORRUPT: Payload = {
  features: 'abc',
  weightGoal: { direction: 'sideways', loseTarget: '170' },
  experience: { haptics: 'false' },
  filters: { warmupThreshold: '0.75' },
  prBaselineDate: 'last tuesday',
  strengthBaselineMode: 'forever',
  recentBaselineWeeks: '8',
  theme: 'future-theme',
  colorMode: 'sepia',
  weightUnit: 'pounds',
  restTimerEnabled: 'false',
  restTimerAutoStart: 0,
  appIcon: 'AppIcon-fire',
  intensityPresets: 'fast',
  coachProfile: 'coach me',
  gyms: 'Home',
}

/**
 * Hydrate a fresh store from `blob` through each way a stored blob reaches one,
 * and report the payload each store then writes.
 */
function hydrateEveryWay(blob: Payload): { guest: Payload; reloaded: Payload; applied: Payload } {
  const serialized = JSON.stringify(blob)

  // The state factory: a local-only guest, or any launch before init().
  localStorageMock.clear()
  localStorageMock.setItem('user-preferences', serialized)
  setActivePinia(createPinia())
  const guest = jsonRoundTrip(usePreferencesStore()._buildPayload())

  // The cross-tab reload: another tab wrote the blob after this one started.
  localStorageMock.clear()
  setActivePinia(createPinia())
  const otherTab = usePreferencesStore()
  localStorageMock.setItem('user-preferences', serialized)
  otherTab._reloadFromStorage()
  const reloaded = jsonRoundTrip(otherTab._buildPayload())

  // `_applyPreferences` itself, the call `_fetchFromSupabase` hands a remote
  // row to.
  localStorageMock.clear()
  setActivePinia(createPinia())
  const remote = usePreferencesStore()
  remote._applyPreferences(JSON.parse(serialized))
  const applied = jsonRoundTrip(remote._buildPayload())

  return { guest, reloaded, applied }
}

describe('preferences blob is read through one parser (LIFT-1495)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('the fixtures cover every field _buildPayload writes, CUSTOM each at a non-default value', () => {
    const defaults = defaultPayload()
    const fields = Object.keys(defaults).sort()
    // Non-vacuity for everything below: an empty payload agrees with any parser.
    expect(fields.length).toBeGreaterThan(10)
    expect(Object.keys(CUSTOM).sort()).toEqual(fields)
    expect(Object.keys(CORRUPT).sort()).toEqual(fields)
    for (const field of fields) {
      expect(CUSTOM[field], `CUSTOM.${field} must differ from its default`).not.toEqual(defaults[field])
    }
  })

  it('reads back every field _buildPayload writes, at its default value', () => {
    // Taken from the store, not the fixtures: a field added to `_buildPayload`
    // and not to the parser fails here with nothing else changed. Defaults are
    // the strict case, since a falsy default (`false`, `null`) is exactly what
    // a truthiness check drops, and a dropped explicit value is one another
    // tab or device can never propagate here (LIFT-1178's `prBaselineDate`).
    const payload = defaultPayload()
    expect(parsePreferencesPayload(payload)).toEqual(payload)
  })

  it('round-trips every field at a non-default value', () => {
    const payload = jsonRoundTrip(CUSTOM)
    expect(parsePreferencesPayload(payload)).toEqual(payload)
  })

  it.each(Object.keys(CUSTOM))('reads %s from its own key alone', (field) => {
    // A partial payload overrides only what it carries, and each field is read
    // from its own key: a reader that looked at a neighbour's key (say
    // `restTimerEnabled` for `restTimerAutoStart`) would come back empty here.
    const single = jsonRoundTrip({ [field]: CUSTOM[field] })
    expect(parsePreferencesPayload(single)).toEqual(single)
  })

  it('hydrates a customized blob to the same state through every entry point', () => {
    const { guest, reloaded, applied } = hydrateEveryWay(CUSTOM)
    expect(guest).toEqual(CUSTOM)
    expect(reloaded).toEqual(CUSTOM)
    expect(applied).toEqual(CUSTOM)
  })

  it('degrades a corrupt blob to the same defaults through every entry point', () => {
    const defaults = defaultPayload()
    const { guest, reloaded, applied } = hydrateEveryWay(CORRUPT)
    expect(guest).toEqual(defaults)
    expect(reloaded).toEqual(defaults)
    expect(applied).toEqual(defaults)
  })

  it('a guest reads an unparseable blob the way bindUser does, from the FOUC mirror keys', () => {
    // The state factory now reads the blob through the same guarded
    // `loadStoreData` call as `bindUser` and the cross-tab reload. It used to
    // `JSON.parse` inline, and an unparseable blob threw past the legacy-key
    // fallback as well, so a guest was reset to the defaults while `initTheme`
    // (which paints from these keys before Pinia exists) had painted their real
    // theme, and a signed-in user on the same storage got the keys back from
    // `bindUser`.
    localStorageMock.setItem('user-preferences', 'not-valid-json{')
    localStorageMock.setItem('app-theme', 'fire')
    localStorageMock.setItem('app-mode', 'light')
    localStorageMock.setItem('weight-unit', 'kg')
    localStorageMock.setItem('rest-timer', 'off')
    localStorageMock.setItem('rest-timer-autostart', 'off')

    const guest = usePreferencesStore()
    expect(guest.theme).toBe('fire')
    expect(guest.colorMode).toBe('light')
    expect(guest.weightUnit).toBe('kg')
    expect(guest.restTimerEnabled).toBe(false)
    expect(guest.restTimerAutoStart).toBe(false)

    setActivePinia(createPinia())
    const signedIn = usePreferencesStore()
    signedIn.bindUser('user-1')
    expect(jsonRoundTrip(guest._buildPayload())).toEqual(jsonRoundTrip(signedIn._buildPayload()))
  })
})
