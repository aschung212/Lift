/**
 * The shared share pipeline for the app-link (#713) and workout-card (#305)
 * share surfaces (#880).
 *
 * Both share surfaces run the same shape of flow — an ordered list of tiers
 * (native system sheet → Web Share API → a local fallback), guarded against
 * re-entrancy, never throwing on user-cancel, and surfacing failures as a
 * typed outcome rather than a rejection. They diverge ONLY in their payload
 * (a text/URL blurb vs a rasterized image Blob) and their final fallback
 * (copy-to-clipboard vs download-to-disk). This helper owns everything they
 * share so the two callers can't drift in error handling or cancellation
 * semantics; each caller supplies its tiers as `ShareAttempt`s.
 */

import { ref, type Ref } from 'vue'

/**
 * The unified outcome of any share flow. A single union across both surfaces
 * so callers handle share results uniformly — the app-link flow only ever
 * yields `shared | copied | unavailable | cancelled | error`, and the card
 * flow only ever yields `shared | downloaded | cancelled | error`, but both
 * are described by this one type.
 */
export type ShareResult =
  | { kind: 'shared' }                        // native sheet / Web Share resolved
  | { kind: 'copied' }                        // fell back to clipboard
  | { kind: 'downloaded'; filename: string }  // fell back to a file download
  | { kind: 'cancelled' }                     // user dismissed the share sheet
  | { kind: 'unavailable' }                   // no tier could handle the payload
  | { kind: 'error'; error: Error }

/**
 * One tier of a share flow. Resolves with a terminal `ShareResult` to end the
 * flow, or `null` to fall through to the next tier. Thrown errors are caught by
 * the runner and surfaced as `{ kind: 'error' }`.
 */
export type ShareAttempt = () => Promise<ShareResult | null>

/**
 * A native-share or Web-Share cancel surfaces as a thrown error whose name is
 * `AbortError` (Web Share API) or whose message mentions cancel/abort (the
 * Capacitor Share plugin). Treat both as a user dismissal, not a failure.
 */
export function isShareCancellation(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  const message = (err as { message?: string })?.message?.toLowerCase() ?? ''
  return message.includes('cancel') || message.includes('abort')
}

export interface ShareFlow {
  /** True while a share is in flight; used to disable the trigger and guard re-entrancy. */
  isSharing: Ref<boolean>
  /** The last unexpected error, or null. Cleared at the start of each run. */
  lastError: Ref<Error | null>
  /**
   * Run the given tiers in order. Returns the first terminal result; if every
   * tier falls through, resolves `{ kind: 'unavailable' }`. Re-entrant calls
   * while a run is in flight resolve `{ kind: 'cancelled' }` without starting.
   */
  run: (attempts: ShareAttempt[]) => Promise<ShareResult>
}

export function useShareFlow(): ShareFlow {
  const isSharing = ref(false)
  const lastError = ref<Error | null>(null)

  async function run(attempts: ShareAttempt[]): Promise<ShareResult> {
    if (isSharing.value) return { kind: 'cancelled' }
    isSharing.value = true
    lastError.value = null
    try {
      for (const attempt of attempts) {
        const result = await attempt()
        if (result) return result
      }
      return { kind: 'unavailable' }
    } catch (err) {
      lastError.value = err as Error
      return { kind: 'error', error: err as Error }
    } finally {
      isSharing.value = false
    }
  }

  return { isSharing, lastError, run }
}
