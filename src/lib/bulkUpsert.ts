/**
 * Multi-row upserts for Supabase (LIFT-1526).
 *
 * Every write in the app goes out one row per request, which is right for a
 * user logging a set: the row is tiny, and keying it `set:<id>` lets a later
 * edit of the same set replace it in the queue. It is wrong for a CSV import.
 * A two-year Strong history is ~8,000 sets, and as 8,000 queued writes it hits
 * the queue's 200-per-minute rate limit (forty minutes to drain), fires up to
 * 200 requests at once each window, and journals every one by re-serializing
 * the whole journal, which is quadratic and freezes the main thread. As a
 * handful of 500-row requests it takes seconds.
 *
 * A multi-row upsert has one rule a single-row one does not. postgrest-js
 * sends the UNION of the rows' keys as the `columns` parameter, and with its
 * default `defaultToNull: true` a row that lacks one of those columns is
 * written with NULL there: on an insert it does not fall back to the column's
 * DEFAULT, and on a conflict it overwrites the stored value. Two producers
 * omit a column on purpose. `_buildExerciseUpsert` leaves out `input_mode`
 * when the exercise has none, so the column's `DEFAULT 'numpad'` applies, and
 * `_buildSetUpsert` leaves out `created_at` for a legacy set with no log time,
 * so the server's own value stands. Both columns are NOT NULL. A request that
 * mixed a row carrying one of them with a row lacking it would therefore fail
 * as a whole, with nothing wrong in any individual row. So rows are only ever
 * batched with rows that send exactly the same columns.
 */

/**
 * Rows per request. Half the read-side page (`SUPABASE_MAX_ROWS`): a set row
 * is ~250 bytes of JSON, so a full chunk stays far below any request-body
 * limit, and one failed request costs at most this many rows a retry.
 */
export const BULK_UPSERT_CHUNK = 500

/**
 * Split rows into requests that are safe to send as multi-row upserts: every
 * row in a chunk has exactly the same keys, and no chunk is longer than `size`.
 *
 * Grouped by key SET rather than by key order, since postgrest-js derives
 * `columns` from the keys alone. Groups come out in the order their first row
 * appeared, and rows keep their relative order inside a group.
 */
export function chunkUniformRows<T extends object>(rows: readonly T[], size = BULK_UPSERT_CHUNK): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`)
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const signature = Object.keys(row).sort().join(',')
    const group = groups.get(signature)
    if (group) group.push(row)
    else groups.set(signature, [row])
  }
  const chunks: T[][] = []
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += size) chunks.push(group.slice(i, i + size))
  }
  return chunks
}
