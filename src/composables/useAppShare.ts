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
 * The native→Web-Share→fallback sequencing, re-entrancy guard, and
 * cancel-never-throws contract all live in `useShareFlow` (#880); this
 * composable only supplies the text/URL tiers. Resolves with a typed outcome
 * the caller can use to decide whether to surface a "link copied" confirmation.
 */

import { isNative } from '../lib/platform'
import { appUrlWithRef, APP_NAME, APP_TAGLINE, SHARE_REF } from '../lib/appMeta'
import { useShareFlow, isShareCancellation, type ShareResult } from './useShareFlow'
import type { Ref } from 'vue'

/** @deprecated Use the shared {@link ShareResult}; kept as an alias for clarity at call sites. */
export type AppShareResult = ShareResult

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
  shareApp: () => Promise<ShareResult>
  isSharing: Ref<boolean>
  lastError: Ref<Error | null>
}

export function useAppShare(): UseAppShareReturn {
  const { isSharing, lastError, run } = useShareFlow()

  function shareApp(): Promise<ShareResult> {
    // Tag the shared link with the app-share attribution ref (#798) so a
    // share-driven install is credited to this surface instead of "direct".
    const shareUrl = appUrlWithRef(SHARE_REF.app)

    return run([
      // Tier 1: native system share sheet.
      async () => {
        if (!isNative) return null
        try {
          const { Share } = await import('@capacitor/share')
          await Share.share({
            title: APP_NAME,
            text: APP_TAGLINE,
            url: shareUrl,
            dialogTitle: 'Share Lift',
          })
          return { kind: 'shared' }
        } catch (err) {
          if (isShareCancellation(err)) return { kind: 'cancelled' }
          // Native plugin failed unexpectedly — fall through to clipboard.
          return null
        }
      },

      // Tier 2: Web Share API (iOS Safari PWA, Android Chrome).
      async () => {
        if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return null
        try {
          await navigator.share({ title: APP_NAME, text: APP_TAGLINE, url: shareUrl })
          return { kind: 'shared' }
        } catch (err) {
          if (isShareCancellation(err)) return { kind: 'cancelled' }
          // Anything else falls through to clipboard.
          return null
        }
      },

      // Tier 3: copy the link so the user can paste it anywhere.
      // When this also fails the runner resolves `{ kind: 'unavailable' }`.
      async () => ((await copyToClipboard(shareUrl)) ? { kind: 'copied' } : null),
    ])
  }

  return { shareApp, isSharing, lastError }
}
