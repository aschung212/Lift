import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() }
}))
vi.mock('../../lib/conflictResolver', () => ({
  mergeEntities: vi.fn(() => ({ merged: [], localOnly: [], localWins: [] }))
}))
vi.mock('../../lib/crossTabSync', () => ({
  broadcastStoreUpdate: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { usePreferencesStore } from '../preferences'
import { useProgressionStore } from '../progression'
import { broadcastStoreUpdate } from '../../lib/crossTabSync'

describe('_reloadFromStorage (cross-tab sync)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    vi.mocked(broadcastStoreUpdate).mockClear()
  })

  describe('workout store', () => {
    it('reloads exercises from localStorage', () => {
      const store = useWorkoutStore()
      expect(store.exercises).toHaveLength(0)

      // Simulate another tab writing to localStorage
      const exercises = [{ id: 'ex1', name: 'Squat', tags: ['Legs'], sets: [], updated_at: new Date().toISOString() }]
      localStorageMock.setItem('workout-exercises', JSON.stringify(exercises))

      store._reloadFromStorage()

      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].name).toBe('Squat')
    })

    it('reloads custom tags from localStorage', () => {
      const store = useWorkoutStore()
      localStorageMock.setItem('lift-custom-tags', JSON.stringify(['Push', 'Pull']))

      store._reloadFromStorage()

      expect(store.customTags).toEqual(['Push', 'Pull'])
    })

    it('broadcasts on _persist()', () => {
      const store = useWorkoutStore()
      store.addExercise('Deadlift')
      expect(broadcastStoreUpdate).toHaveBeenCalledWith('workout')
    })
  })

  describe('bodyweight store', () => {
    it('reloads entries from localStorage', () => {
      const store = useBodyweightStore()
      expect(store.entries).toHaveLength(0)

      const entries = [{ id: 'bw1', date: '2026-04-29', weight: 185, updated_at: new Date().toISOString() }]
      localStorageMock.setItem('bodyweight-entries', JSON.stringify(entries))

      store._reloadFromStorage()

      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].weight).toBe(185)
    })

    it('broadcasts on _persist()', () => {
      const store = useBodyweightStore()
      store.addEntry(185, '2026-04-29')
      expect(broadcastStoreUpdate).toHaveBeenCalledWith('bodyweight')
    })
  })

  describe('preferences store', () => {
    it('reloads features and experience from localStorage', () => {
      const store = usePreferencesStore()

      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: false, weight: true },
        experience: { prCelebrations: false, haptics: true, screenWakeLock: true },
      }))

      store._reloadFromStorage()

      expect(store.features.calendar).toBe(false)
      expect(store.experience.prCelebrations).toBe(false)
    })

    it('broadcasts on _persist()', () => {
      const store = usePreferencesStore()
      store.toggleFeature('calendar')
      expect(broadcastStoreUpdate).toHaveBeenCalledWith('preferences')
    })
  })

  describe('progression store', () => {
    it('reloads progression state from localStorage', () => {
      const store = useProgressionStore()

      localStorageMock.setItem('user-progression', JSON.stringify({
        totalXP: 5000,
        streakWeeks: 3,
        weeklyTarget: 4,
        pendingTargetChange: null,
        showProgression: true,
        progressionEnabled: true,
        epoch: 1,
        unlockedThemes: [{ id: 'pearl', unlockedAt: new Date().toISOString() }],
        starterTheme: 'fire',
        starterConfirmed: true,
        streakHistory: [],
        xpPerSet: {},
        bodyweightXPDates: [],
      }))

      store._reloadFromStorage()

      expect(store.totalXP).toBe(5000)
      expect(store.streakWeeks).toBe(3)
      expect(store.weeklyTarget).toBe(4)
    })

    it('preserves _userId across reload', () => {
      const store = useProgressionStore()
      // Simulate userId being set via init
      store._userId = 'user-123'

      localStorageMock.setItem('user-progression', JSON.stringify({
        totalXP: 1000,
        streakWeeks: 1,
        weeklyTarget: 3,
        pendingTargetChange: null,
        showProgression: true,
        progressionEnabled: true,
        epoch: 1,
        unlockedThemes: [{ id: 'pearl', unlockedAt: new Date().toISOString() }],
        starterTheme: null,
        starterConfirmed: false,
        streakHistory: [],
        xpPerSet: {},
        bodyweightXPDates: [],
      }))

      store._reloadFromStorage()

      expect(store._userId).toBe('user-123')
      expect(store.totalXP).toBe(1000)
    })

    it('broadcasts on _persist()', () => {
      const store = useProgressionStore()
      store._persist()
      expect(broadcastStoreUpdate).toHaveBeenCalledWith('progression')
    })
  })
})
