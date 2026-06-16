import { importCSV } from '../lib/csvImport'
import { useWorkoutStore } from '../stores/workout'
import { useAnalytics } from './useAnalytics'

export interface CsvImportSummary {
  exercises: number
  sets: number
  format: string
  error?: string
}

/**
 * Shared CSV import flow used by both the Settings file-picker and the PWA
 * Web Share Target. Parses Strong/Hevy/Lift CSV text, writes the resulting
 * exercises and sets into the local-first workout store (sync deferred so the
 * batch debounces into a single background push), and logs an analytics event
 * tagged with the entry point.
 */
export function useCsvImport() {
  const workoutStore = useWorkoutStore()
  const { logEvent } = useAnalytics()

  function importFromText(text: string, source: 'file' | 'share_target' = 'file'): CsvImportSummary {
    const result = importCSV(text)
    if (result.format === 'unknown' || result.exercises.length === 0) {
      return {
        exercises: 0,
        sets: 0,
        format: 'unknown',
        error: 'Unrecognized format. Supported: Strong, Hevy, Lift CSV.',
      }
    }
    for (const ex of result.exercises) {
      const existingId = workoutStore.addExercise(ex.name, ex.tags, { sync: false })
      if (!existingId) continue
      for (const set of ex.sets) {
        workoutStore.logSet(existingId, set.weight, set.reps, set.date.slice(0, 10), { sync: false })
      }
    }
    logEvent('data_import', {
      format: result.format,
      exercises: result.exercises.length,
      sets: result.totalSets,
      source,
    })
    return { exercises: result.exercises.length, sets: result.totalSets, format: result.format }
  }

  return { importFromText }
}
