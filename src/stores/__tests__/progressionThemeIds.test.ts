/**
 * Regression: a persisted theme id must name a theme this build can render
 * (LIFT-1503).
 *
 * The progression store holds two `ThemeId` values that come back out of
 * user-writable storage — `unlockedThemes[].id` (a JSONB column, mirrored into
 * the `user-progression` localStorage blob) and `starterTheme` (a `text` column
 * with no CHECK constraint) — and both used to arrive by unchecked cast.
 *
 * That is not inert, because the two things the app does with an unlock entry
 * disagree about an unrecognised id: `isThemeUnlocked` answers by EQUALITY
 * against a current id, so the entry matches nothing and the theme reads as
 * LOCKED (`enforceThemeLock` then flips the user to pearl), while
 * `unlockedThemes.length` — the analytics `themesUnlocked` and the unlock
 * celebration's `unlockedCount` — counts it. The app reported a theme as
 * unlocked and refused to apply it, from one array read two lines apart.
 *
 * A garbage `starterTheme` is worse than unspendable: `checkUnlocks` feeds it
 * straight to `addTheme` at tier 1, minting a permanent unlock entry for a
 * theme that does not exist and then syncing it to the server.
 *
 * Why nothing caught it: every `parseUnlockedThemes` fixture used a real theme
 * id, where the cast and a real check are indistinguishable — the same blind
 * spot that hid LIFT-1494. So these tests seed a LEGACY id and an UNKNOWN one
 * and assert what `isThemeUnlocked` says about the theme each one stands for,
 * rather than stopping at the parser's return value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { remote } = vi.hoisted(() => ({
  remote: { row: null as Record<string, unknown> | null },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() },
}))

vi.mock('../../lib/supabase', () => ({
  isPreviewMode: { value: false },
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: remote.row, error: null }),
        }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
  },
}))

import { useProgressionStore, getUnlockedThemeIds } from '../progression'
import { useTheme, connectProgressionStore } from '../../composables/useTheme'
import { THEME_MIGRATION } from '../../lib/themes'

/** Seed the persisted progression blob, then hydrate a fresh store from it. */
function hydrate(blob: Record<string, unknown>) {
  localStorage.setItem('user-progression', JSON.stringify(blob))
  setActivePinia(createPinia())
  const store = useProgressionStore()
  connectProgressionStore(() => store)
  return { store, theme: useTheme() }
}

/** A `user_progression` row as PostgREST returns it. */
function remoteRow(over: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    total_xp: 0,
    streak_weeks: 0,
    weekly_target: 4,
    pending_target_change: null,
    show_progression: true,
    progression_enabled: true,
    unlocked_themes: [{ id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' }],
    starter_theme: null,
    starter_confirmed: true,
    epoch: 1,
    streak_history: [],
    xp_per_set: {},
    bodyweight_xp_dates: [],
    ...over,
  }
}

describe('persisted theme ids (LIFT-1503)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    remote.row = null
  })

  describe('unlockedThemes hydrated from localStorage', () => {
    it('migrates a legacy id so the entitlement is spendable, not merely counted', () => {
      const { store, theme } = hydrate({
        progressionEnabled: true,
        starterConfirmed: true,
        unlockedThemes: [
          { id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' },
          // 'graphite' is the pre-2026-04-02 name for Focus.
          { id: 'graphite', unlockedAt: '2026-02-01T00:00:00Z' },
        ],
      })

      expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual(['pearl', 'amethyst'])
      // The half that was broken: the id the user actually earned is unlockable.
      expect(theme.isThemeUnlocked('amethyst')).toBe(true)
      // …and the count that was always right still agrees with it.
      expect(store.unlockedThemes).toHaveLength(2)
      // The unlock timestamp survives the rename — it is what mergeUnlockedThemes
      // compares across devices.
      expect(store.unlockedThemes[1].unlockedAt).toBe('2026-02-01T00:00:00Z')
    })

    it('drops an entry naming no known theme instead of counting an unspendable unlock', () => {
      const { store, theme } = hydrate({
        progressionEnabled: true,
        starterConfirmed: true,
        unlockedThemes: [
          { id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' },
          { id: 'not-a-theme', unlockedAt: '2026-02-01T00:00:00Z' },
        ],
      })

      expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual(['pearl'])
      // The contradiction is gone: nothing in the list is un-applyable, so the
      // count and isThemeUnlocked can no longer disagree.
      expect(store.unlockedThemes).toHaveLength(1)
      for (const unlock of store.unlockedThemes) {
        expect(theme.isThemeUnlocked(unlock.id)).toBe(true)
      }
    })

    it('falls back to pearl when every entry is unknown', () => {
      const { store, theme } = hydrate({
        progressionEnabled: true,
        starterConfirmed: true,
        unlockedThemes: [{ id: 'nope', unlockedAt: '2026-02-01T00:00:00Z' }],
      })

      expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual(['pearl'])
      expect(theme.isThemeUnlocked('pearl')).toBe(true)
    })

    it('collapses two legacy ids that migrate onto the same theme, keeping the earliest unlock', () => {
      // 'tina' and 'bloom' are both Love — migrating without deduping would
      // double-count in themesUnlocked/unlockedCount, i.e. re-create the inflated
      // count this fix exists to remove.
      const { store, theme } = hydrate({
        progressionEnabled: true,
        starterConfirmed: true,
        unlockedThemes: [
          { id: 'bloom', unlockedAt: '2026-05-01T00:00:00Z', totalXPAtUnlock: 900 },
          { id: 'tina', unlockedAt: '2026-03-01T00:00:00Z', totalXPAtUnlock: 300 },
        ],
      })

      expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual(['love'])
      expect(store.unlockedThemes[0].unlockedAt).toBe('2026-03-01T00:00:00Z')
      expect(store.unlockedThemes[0].totalXPAtUnlock).toBe(300)
      expect(theme.isThemeUnlocked('love')).toBe(true)
    })

    it('migrates and filters the legacy string[] shape too', () => {
      const { store, theme } = hydrate({
        progressionEnabled: true,
        starterConfirmed: true,
        unlockedThemes: ['pearl', 'arctic', 'not-a-theme', 42],
      })

      expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual(['pearl', 'water'])
      expect(theme.isThemeUnlocked('water')).toBe(true)
    })

    it('covers every id in THEME_MIGRATION — a rename is only survivable if the table is', () => {
      for (const [legacy, current] of Object.entries(THEME_MIGRATION)) {
        localStorageMock.clear()
        const { store, theme } = hydrate({
          progressionEnabled: true,
          starterConfirmed: true,
          unlockedThemes: [{ id: legacy, unlockedAt: '2026-02-01T00:00:00Z' }],
        })
        expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual([current])
        expect(theme.isThemeUnlocked(current)).toBe(true)
      }
    })
  })

  describe('starterTheme hydrated from localStorage', () => {
    it('mints no unlock for a starter that names no theme', () => {
      const { store } = hydrate({
        progressionEnabled: true,
        starterTheme: 'not-a-theme',
        // Past tier 1 (5,000 XP), which is where checkUnlocks reads starterTheme.
        totalXP: 6000,
        xpPerSet: { 's1': 6000 },
      })

      // An unreadable value is closest to "not picked yet" — the state the
      // starter picker can recover from — not to a theme the user chose.
      expect(store.starterTheme).toBeNull()
      store.checkUnlocks()
      expect(getUnlockedThemeIds(store.unlockedThemes)).not.toContain('not-a-theme')
      expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual(['pearl'])
    })

    it('migrates a legacy starter rather than discarding the pick', () => {
      const { store } = hydrate({ progressionEnabled: true, starterTheme: 'aaron' })
      expect(store.starterTheme).toBe('luck')
    })

    it('leaves a real starter and a never-picked one alone', () => {
      expect(hydrate({ starterTheme: 'fire' }).store.starterTheme).toBe('fire')
      localStorageMock.clear()
      expect(hydrate({ progressionEnabled: true }).store.starterTheme).toBeNull()
    })
  })

  describe('remote row', () => {
    it('keeps the local starter when starter_theme names no theme', async () => {
      const { store } = hydrate({ progressionEnabled: true, starterTheme: 'fire' })
      remote.row = remoteRow({ starter_theme: 'not-a-theme' })

      await store.init('u1')

      // Treated exactly like an absent value: remote-wins does not extend to a
      // string the client cannot resolve.
      expect(store.starterTheme).toBe('fire')
    })

    it('adopts a legacy starter_theme as its current id', async () => {
      const { store } = hydrate({ progressionEnabled: true })
      remote.row = remoteRow({ starter_theme: 'arctic' })

      await store.init('u1')

      expect(store.starterTheme).toBe('water')
    })

    it('makes a legacy unlocked_themes entry spendable after a fetch', async () => {
      const { store, theme } = hydrate({ progressionEnabled: true, starterConfirmed: true })
      remote.row = remoteRow({
        unlocked_themes: [
          { id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' },
          { id: 'forge', unlockedAt: '2026-02-01T00:00:00Z' },
          { id: 'not-a-theme', unlockedAt: '2026-02-01T00:00:00Z' },
        ],
      })

      await store.init('u1')

      // 'forge' migrates onto pearl, which the local row already holds — the
      // union keeps one entry, not two.
      expect(getUnlockedThemeIds(store.unlockedThemes)).toEqual(['pearl'])
      expect(theme.isThemeUnlocked('pearl')).toBe(true)
    })
  })
})
