/**
 * Warmup set classification.
 *
 * A set is a "warmup" if, within the same session (same date) for the same
 * exercise, it comes before the top set (highest estimated 1RM) AND its own
 * estimated 1RM is below `threshold × top_e1RM`. Sets at or after the top
 * set, or above the threshold, are considered working sets.
 */

interface SetLike {
  id: string
  date: string
  estimated1RM: number
}

interface ExerciseLike {
  sets: SetLike[]
}

/** Extract the YYYY-MM-DD portion of an ISO date string for session grouping. */
function sessionKey(date: string): string {
  return date.slice(0, 10)
}

/**
 * Build the set of set IDs that are warmups across the given exercises.
 *
 * @param exercises   exercises with their sets in the order they were logged
 * @param threshold   e1RM ratio (0–1); sets below `threshold × session_top_e1RM`
 *                    that occur before the top set are classified as warmups
 */
export function buildWarmupSetIds(
  exercises: ExerciseLike[],
  threshold: number,
): Set<string> {
  const warmupIds = new Set<string>()
  if (threshold <= 0 || threshold > 1) return warmupIds

  for (const ex of exercises) {
    // Group set indices by session date so we can find the top set per session.
    const sessions = new Map<string, number[]>()
    ex.sets.forEach((set, idx) => {
      const key = sessionKey(set.date)
      const list = sessions.get(key)
      if (list) list.push(idx)
      else sessions.set(key, [idx])
    })

    for (const indices of sessions.values()) {
      // Find the first index that achieves the session's max e1RM.
      let topIdx = indices[0]
      let topE1RM = ex.sets[topIdx].estimated1RM
      for (const i of indices) {
        if (ex.sets[i].estimated1RM > topE1RM) {
          topE1RM = ex.sets[i].estimated1RM
          topIdx = i
        }
      }
      if (topE1RM <= 0) continue

      const cutoff = topE1RM * threshold
      for (const i of indices) {
        if (i >= topIdx) break
        if (ex.sets[i].estimated1RM < cutoff) {
          warmupIds.add(ex.sets[i].id)
        }
      }
    }
  }

  return warmupIds
}
