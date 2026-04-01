/**
 * Muscle group definitions and tag-to-muscle-group mapping.
 * Used to aggregate weekly set volume by muscle group.
 */

export const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Legs',
  'Core',
] as const

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

/**
 * Maps exercise tags to primary muscle groups they target.
 * Case-insensitive matching. Tags not in this map are ignored
 * for muscle group aggregation (they may be movement patterns
 * or user-specific labels).
 */
const TAG_TO_MUSCLE_GROUPS: Record<string, MuscleGroup[]> = {
  // Direct muscle group tags
  chest: ['Chest'],
  back: ['Back'],
  shoulders: ['Shoulders'],
  biceps: ['Biceps'],
  triceps: ['Triceps'],
  arms: ['Biceps', 'Triceps'],
  legs: ['Legs'],
  quads: ['Legs'],
  hamstrings: ['Legs'],
  glutes: ['Legs'],
  calves: ['Legs'],
  core: ['Core'],
  abs: ['Core'],

  // Movement pattern tags → muscle groups
  push: ['Chest', 'Shoulders', 'Triceps'],
  pull: ['Back', 'Biceps'],
}

/**
 * Given an exercise's tags, returns the unique set of muscle groups targeted.
 * Uses the TAG_TO_MUSCLE_GROUPS mapping with case-insensitive lookup.
 */
export function getMuscleGroups(tags: string[]): MuscleGroup[] {
  const groups = new Set<MuscleGroup>()
  for (const tag of tags) {
    const mapped = TAG_TO_MUSCLE_GROUPS[tag.toLowerCase()]
    if (mapped) {
      for (const g of mapped) groups.add(g)
    }
  }
  return Array.from(groups)
}

