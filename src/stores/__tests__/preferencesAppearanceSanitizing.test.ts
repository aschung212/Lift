/**
 * LIFT-1494 — the four appearance settings must be coerced into their unions at
 * EVERY persistence boundary, not cast into them at the accessors.
 *
 * `initialPreferencesState` declared `theme: 'eternal' as string`, `colorMode`,
 * `weightUnit` and `appIcon` the same way, deliberately widening away the
 * unions, and every consumer re-narrowed with an unchecked cast
 * (`prefs.weightUnit as WeightUnit`). `_applyPreferences` and `loadLocalSettings`
 * accepted ANY string, so a corrupt or future-version value flowed through the
 * whole pipeline silently:
 *
 *  - an unknown weight unit rendered as the visible unit LABEL while
 *    `displayWeight`/`toLbs` fell through to their lbs branches, so the number
 *    and the word beside it described different quantities;
 *  - an unknown theme id reached `data-theme` with no matching palette, so the
 *    page rendered the `:root` fallback while the picker showed nothing selected;
 *  - a LEGACY theme id in the blob (`void`, `graphite`, …) was never migrated —
 *    `initTheme` applies `THEME_MIGRATION` to the standalone `app-theme` key
 *    only, and `applyTheme` then wrote the un-migrated id straight back over it.
 *
 * The blob is read back at four independent boundaries, so each one is exercised
 * here: the state factory (guest / pre-init), `_applyPreferences` (cross-tab
 * reload), `init()`'s legacy standalone keys, and the Supabase row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

let mockRemotePreferences: Record<string, unknown> | null = null

vi.mock('../../lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () =>
      Promise.resolve(
        mockRemotePreferences
          ? { data: { preferences: mockRemotePreferences }, error: null }
          : { data: null, error: { code: 'PGRST116' } },
      ),
    upsert: () => Promise.resolve({ error: null }),
  }
  return {
    supabase: { from: () => chain },
    isPreviewMode: { value: false },
  }
})

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
}))

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

import { usePreferencesStore } from '../preferences'

/** A blob whose four appearance fields are all values the app cannot render. */
const CORRUPT_BLOB = {
  features: { workouts: true, calendar: true, weight: true },
  theme: 'future-theme',
  colorMode: 'sepia',
  weightUnit: 'pounds',
  appIcon: 'AppIcon-fire',
}

function readStoredPayload(): Record<string, unknown> {
  return JSON.parse(localStorageMock.getItem('user-preferences')!)
}

describe('appearance settings are sanitized at every boundary (LIFT-1494)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    mockRemotePreferences = null
    setActivePinia(createPinia())
  })

  describe('state factory (guest / pre-init hydrate)', () => {
    it('coerces a corrupt local blob to the defaults', () => {
      localStorageMock.setItem('user-preferences', JSON.stringify(CORRUPT_BLOB))
      const store = usePreferencesStore()
      // No init() — this is the local-only guest path (LIFT-1177).
      expect(store.theme).toBe('eternal')
      expect(store.colorMode).toBe('dark')
      expect(store.weightUnit).toBe('lbs')
      expect(store.appIcon).toBe('default')
    })

    it('migrates a legacy theme id carried in the blob', () => {
      // `void` → `eternal` per THEME_MIGRATION. Before LIFT-1494 only the
      // standalone `app-theme` key was migrated, so a blob copy of the old id
      // survived every launch and was written back over the migrated key.
      localStorageMock.setItem('user-preferences', JSON.stringify({ theme: 'void' }))
      expect(usePreferencesStore().theme).toBe('eternal')
    })

    it('still honours a legal blob value', () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        theme: 'water', colorMode: 'light', weightUnit: 'kg', appIcon: 'water',
      }))
      const store = usePreferencesStore()
      expect(store.theme).toBe('water')
      expect(store.colorMode).toBe('light')
      expect(store.weightUnit).toBe('kg')
      expect(store.appIcon).toBe('water')
    })

    it('coerces corrupt LEGACY standalone keys too', () => {
      localStorageMock.setItem('app-theme', 'rainbow')
      localStorageMock.setItem('app-mode', 'sepia')
      localStorageMock.setItem('weight-unit', 'stone')
      const store = usePreferencesStore()
      expect(store.theme).toBe('eternal')
      expect(store.colorMode).toBe('dark')
      expect(store.weightUnit).toBe('lbs')
    })
  })

  describe('_applyPreferences (cross-tab reload)', () => {
    it('coerces a corrupt payload written by another tab', () => {
      const store = usePreferencesStore()
      store.setTheme('water')
      store.setWeightUnit('kg')
      localStorageMock.setItem('user-preferences', JSON.stringify(CORRUPT_BLOB))
      store._reloadFromStorage()
      expect(store.theme).toBe('eternal')
      expect(store.colorMode).toBe('dark')
      expect(store.weightUnit).toBe('lbs')
      expect(store.appIcon).toBe('default')
    })

    it('leaves a field the payload does not carry alone', () => {
      const store = usePreferencesStore()
      store.setTheme('fire')
      store.setWeightUnit('kg')
      // A partial payload must still only override the keys it has — the
      // sanitizers run on presence, not on every field unconditionally.
      localStorageMock.setItem('user-preferences', JSON.stringify({ colorMode: 'light' }))
      store._reloadFromStorage()
      expect(store.theme).toBe('fire')
      expect(store.weightUnit).toBe('kg')
      expect(store.colorMode).toBe('light')
    })
  })

  describe('Supabase row', () => {
    it('coerces a corrupt remote blob rather than adopting it', async () => {
      mockRemotePreferences = { ...CORRUPT_BLOB }
      const store = usePreferencesStore()
      await store.init('test-user')
      expect(store.theme).toBe('eternal')
      expect(store.colorMode).toBe('dark')
      expect(store.weightUnit).toBe('lbs')
      expect(store.appIcon).toBe('default')
    })

    it('does not write the corruption back into the local payload', async () => {
      mockRemotePreferences = { ...CORRUPT_BLOB }
      const store = usePreferencesStore()
      await store.init('test-user')
      // init() re-persists the adopted row locally (LIFT-1243). If the raw value
      // survived into the payload, the next cold start would read it back and
      // the next _persist() would upload it again.
      const stored = readStoredPayload()
      expect(stored.theme).toBe('eternal')
      expect(stored.colorMode).toBe('dark')
      expect(stored.weightUnit).toBe('lbs')
      expect(stored.appIcon).toBe('default')
    })

    it('keeps the FOUC mirror keys legal so the pre-Pinia bootstrap agrees', async () => {
      mockRemotePreferences = { ...CORRUPT_BLOB }
      const store = usePreferencesStore()
      await store.init('test-user')
      // main.ts's initTheme() paints from these keys before Pinia exists. A raw
      // value here paints something the store then contradicts — a theme flash
      // on every cold start with nothing else to explain it.
      expect(localStorageMock.getItem('app-theme')).toBe('eternal')
      expect(localStorageMock.getItem('app-mode')).toBe('dark')
      expect(localStorageMock.getItem('weight-unit')).toBe('lbs')
    })
  })

  describe('setters', () => {
    it('coerces a value handed in from untyped code', () => {
      const store = usePreferencesStore()
      // The signatures are union-typed now, so this is only reachable from
      // JS / devtools / a replayed journal — but the store state is what every
      // accessor trusts, so the invariant has to be total.
      store.setTheme('nope' as never)
      store.setColorMode('sepia' as never)
      store.setWeightUnit('pounds' as never)
      store.setAppIcon('bogus' as never)
      expect(store.theme).toBe('eternal')
      expect(store.colorMode).toBe('dark')
      expect(store.weightUnit).toBe('lbs')
      expect(store.appIcon).toBe('default')
    })

    it('still converts stored bar weights on a real unit toggle', async () => {
      // LIFT-1223's conversion used to be gated on a pair of inline
      // `unit === 'lbs' || unit === 'kg'` runtime checks that the union type
      // replaced. The conversion itself must survive that simplification.
      const { useWorkoutStore } = await import('../workout')
      const store = usePreferencesStore()
      const workout = useWorkoutStore()
      const spy = vi.spyOn(workout, 'convertBarWeightsForUnitChange')
      store.setWeightUnit('kg')
      expect(spy).toHaveBeenCalledWith('lbs', 'kg')
      spy.mockClear()
      // A no-op toggle must NOT convert (it would halve every stored bar).
      store.setWeightUnit('kg')
      expect(spy).not.toHaveBeenCalled()
      // Neither must a rejected garbage value, which sanitizes to the current unit.
      store.setWeightUnit('pounds' as never)
      expect(spy).toHaveBeenCalledWith('kg', 'lbs')
    })
  })
})
