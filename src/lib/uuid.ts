/** Build an end-of-day ISO timestamp with random seconds/ms jitter (23:59:00–23:59:59.999).
 *  Keeps the set on the correct calendar day while making each timestamp unique
 *  so the dedup logic never drops intentional duplicate-looking sets. */
export function endOfDayISO(dateStr: string): string {
  const ss = String(Math.floor(Math.random() * 60)).padStart(2, '0')
  const ms = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `${dateStr}T23:59:${ss}.${ms}Z`
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for non-secure contexts (e.g. local dev over HTTP)
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  )
}
