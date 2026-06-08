/**
 * Shares the app itself — the lowest-friction word-of-mouth loop (#713).
 *
 * Distinct from `useWorkoutShare`, which rasterizes and shares a workout *card*.
 * This shares a plain title/text/URL payload so a happy user can hand the app
 * to a friend. Three tiers, mirroring the card flow's degradation:
 *   1. Native (Capacitor): the iOS/Android system share sheet via @capacitor/share.
 *   2. Web Share API: the OS sheet on the iOS Safari PWA / Android Chrome.
 *   3. Clipboard fallback: copy the URL so the user can paste it anywhere.
 *
 * Never throws on user cancel — resolves with a typed outcome the caller can
 * use to decide whether to surface a "link copied" confirmation.
 */

import { ref, type Ref } from 'vue'
import { isNative } from '../lib/platform'
import { APP_URL, APP_NAME, APP_TAGLINE } from '../lib/appMeta'

export type AppShareResult =
  | { kind: 'shared' }       // native sheet / Web Share resolved
  | { kind: 'copied' }       // fell back to clipboard
  | { kind: 'cancelled' }    // user dismissed the share sheet
  | { kind: 'unavailable' }  // no share + no clipboard (rare)
  | { kind: 'error'; error: Error }

/** A native-share cancel surfaces as a thrown error whose message mentions cancel/abort. */
function isCancellation(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  const message = (err as { message?: string })?.message?.toLowerCase() ?? ''
  return message.includes('cancel') || message.includes('abort')
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* clipboard blocked or unavailable */
  }
  return false
}

export interface UseAppShareReturn {
  shareApp: () => Promise<AppShareResult>
  isSharing: Ref<boolean>
}

export function useAppShare(): UseAppShareReturn {
  const isSharing = ref(false)

  async function shareApp(): Promise<AppShareResult> {
    if (isSharing.value) return { kind: 'cancelled' }
    isSharing.value = true
    try {
      // Tier 1: native system share sheet.
      if (isNative) {
        try {
          const { Share } = await import('@capacitor/share')
          await Share.share({
            title: APP_NAME,
            text: APP_TAGLINE,
            url: APP_URL,
            dialogTitle: 'Share Lift',
          })
          return { kind: 'shared' }
        } catch (err) {
          if (isCancellation(err)) return { kind: 'cancelled' }
          // Native plugin failed unexpectedly — fall through to clipboard.
        }
      }

      // Tier 2: Web Share API (iOS Safari PWA, Android Chrome).
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: APP_NAME, text: APP_TAGLINE, url: APP_URL })
          return { kind: 'shared' }
        } catch (err) {
          if (isCancellation(err)) return { kind: 'cancelled' }
          // Anything else falls through to clipboard.
        }
      }

      // Tier 3: copy the link so the user can paste it anywhere.
      if (await copyToClipboard(APP_URL)) return { kind: 'copied' }
      return { kind: 'unavailable' }
    } catch (err) {
      return { kind: 'error', error: err as Error }
    } finally {
      isSharing.value = false
    }
  }

  return { shareApp, isSharing }
}
