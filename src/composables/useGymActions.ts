/**
 * Gym CRUD orchestration (#961) shared by both GymManagerModal hosts
 * (WorkoutTracker's filter row and the Settings entry point).
 *
 * The gym LIST lives in the preferences store; per-exercise MEMBERSHIP lives
 * on the workout store. These actions keep the two in step and provide the
 * delete-with-undo flow (mirroring the tag manager's confirmDeleteTag).
 * The device-local active gym filter is deliberately not touched here —
 * WorkoutTracker owns it and reacts to list changes (rename continuity for
 * its own manager; the stale-selection pruning watch for everything else).
 */
import { usePreferencesStore } from '../stores/preferences'
import { useWorkoutStore } from '../stores/workout'
import { useUndoToast } from './useUndoToast'

export interface UseGymActionsReturn {
  /** Create a gym; returns the stored name or null (invalid/duplicate/over cap). */
  createGym: (name: string) => string | null
  /** Rename a gym in the list AND across exercise membership; returns the stored name or null. */
  renameGym: (oldName: string, newName: string) => string | null
  /** Delete a gym from the list and strip it from all exercises, with an undo toast. */
  deleteGym: (name: string) => void
  /** Toggle one exercise's membership in a gym (the manager's checklist rows). */
  toggleExerciseGym: (exerciseId: string, gym: string) => void
}

export function useGymActions(): UseGymActionsReturn {
  const prefs = usePreferencesStore()
  const store = useWorkoutStore()
  const { show: showUndo } = useUndoToast()

  function createGym(name: string): string | null {
    return prefs.addGym(name)
  }

  function renameGym(oldName: string, newName: string): string | null {
    const stored = prefs.renameGym(oldName, newName)
    if (stored && stored !== oldName) {
      store.renameGymOnExercises(oldName, stored)
    }
    return stored
  }

  function deleteGym(name: string) {
    if (!prefs.gyms.includes(name)) return
    const affectedIds = store.removeGymFromExercises(name)
    prefs.removeGym(name)
    const count = affectedIds.length
    showUndo(
      `Gym "${name}" deleted${count > 0 ? ` — removed from ${count} exercise${count !== 1 ? 's' : ''}` : ''}`,
      () => {
        // Restore the list entry first so membership chips have a live gym
        // to point at, then re-add membership on each affected exercise.
        prefs.addGym(name)
        for (const id of affectedIds) {
          const exercise = store.exercises.find(e => e.id === id)
          if (exercise && !(exercise.gyms || []).includes(name)) {
            store.setExerciseGyms(id, [...(exercise.gyms || []), name])
          }
        }
      },
      () => {},
    )
  }

  function toggleExerciseGym(exerciseId: string, gym: string) {
    const exercise = store.exercises.find(e => e.id === exerciseId)
    if (!exercise) return
    const gyms = exercise.gyms || []
    store.setExerciseGyms(
      exerciseId,
      gyms.includes(gym) ? gyms.filter(g => g !== gym) : [...gyms, gym],
    )
  }

  return { createGym, renameGym, deleteGym, toggleExerciseGym }
}
