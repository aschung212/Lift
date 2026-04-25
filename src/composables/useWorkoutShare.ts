/**
 * Orchestrates the share flow for issue #305 share cards:
 *   1. Mount a card component offscreen (detached Vue app, no Pinia needed —
 *      cards are pure presentational components that take a typed summary prop).
 *   2. Wait for the next tick so the DOM and CSS are settled, then rasterize
 *      the card to a PNG Blob via `html-to-image`.
 *   3. Share via the native iOS share sheet (Capacitor), the Web Share API
 *      (browser, iOS Safari 16.4+ supports image files), or fall back to a
 *      direct download — same Blob → URL.createObjectURL pattern App.vue
 *      already uses for CSV/JSON exports.
 *   4. Always unmount and revoke the object URL.
 */

import { ref, createApp, h, type Component, nextTick } from 'vue'
import {
  renderNodeToBlob,
  defaultShareFilename,
  PREVIEW_SIZE,
  EXPORT_PIXEL_RATIO,
  type CardFormat,
} from '../lib/shareImage'
import type { SessionSummary } from '../lib/sessionSummary'

export interface ShareCardRequest {
  /** The Vue component that renders the card. */
  component: Component
  /** Format determines preview size and pixel-ratio'd output. */
  format: CardFormat
  /** The summary the card needs to render. */
  summary: SessionSummary
  /** Used to scope the offscreen container's data-theme/data-mode. */
  theme: string
  mode: 'dark' | 'light'
}

export type ShareResult =
  | { kind: 'shared' }                   // native sheet / Web Share resolved
  | { kind: 'downloaded'; filename: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; error: Error }

/**
 * Browsers that support image files in the Web Share API.
 * iOS Safari 16.4+ and Android Chrome both report `canShare({ files })` as true.
 */
function canWebShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

/** Triggers a download via a temporary anchor element. Matches the dataExport.ts pattern. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * Build a detached DOM container, mount the card into it, render to Blob,
 * unmount. Returns the Blob.
 */
async function renderCardOffscreen(req: ShareCardRequest): Promise<Blob> {
  const { width, height } = PREVIEW_SIZE[req.format]
  const host = document.createElement('div')
  // Offscreen but rendered: html-to-image needs the node in the DOM with real
  // layout. Negative-position rather than display:none.
  host.style.cssText =
    `position:absolute;left:-10000px;top:0;width:${width}px;height:${height}px;` +
    'pointer-events:none;contain:layout paint;'
  host.setAttribute('data-theme', req.theme)
  host.setAttribute('data-mode', req.mode)

  document.body.appendChild(host)
  const app = createApp({
    render: () => h(req.component, { summary: req.summary }),
  })

  try {
    app.mount(host)
    // Two ticks: first to flush mount, second to flush any computed/CSS
    // recalculation triggered by the freshly-set data-theme/data-mode.
    await nextTick()
    await nextTick()
    return await renderNodeToBlob(host, { width, height, pixelRatio: EXPORT_PIXEL_RATIO })
  } finally {
    app.unmount()
    host.remove()
  }
}

export function useWorkoutShare() {
  const isSharing = ref(false)
  const lastError = ref<Error | null>(null)

  /**
   * Render → share. Resolves with the outcome; never throws on user-cancel.
   * Errors during rendering or unexpected share failures resolve as
   * { kind: 'error' } so the caller can surface a toast.
   */
  async function shareCard(req: ShareCardRequest): Promise<ShareResult> {
    if (isSharing.value) return { kind: 'cancelled' }
    isSharing.value = true
    lastError.value = null
    try {
      const blob = await renderCardOffscreen(req)
      const filename = defaultShareFilename(req.summary.rawDate, req.format)
      const file = new File([blob], filename, { type: 'image/png' })

      // Capacitor native path needs `@capacitor/filesystem` to write the
      // blob to disk so the iOS share plugin can attach the file URL.
      // Until that's wired, sharing on a native build falls through to the
      // Web Share API (works on the iOS Safari PWA which is the current
      // install target) and then to download. Skipping the native sheet
      // entirely is intentional — calling `CapacitorShare.share({ text })`
      // alone would silently drop the rendered image, which is worse than
      // surfacing the download.

      if (canWebShareFiles([file])) {
        try {
          await navigator.share({ files: [file], title: 'Lift workout' })
          return { kind: 'shared' }
        } catch (err) {
          // AbortError = user dismissed sheet. Anything else falls to download.
          if ((err as DOMException).name === 'AbortError') return { kind: 'cancelled' }
        }
      }

      downloadBlob(blob, filename)
      return { kind: 'downloaded', filename }
    } catch (err) {
      lastError.value = err as Error
      return { kind: 'error', error: err as Error }
    } finally {
      isSharing.value = false
    }
  }

  /** Skip the share sheet and download directly. */
  async function downloadCard(req: ShareCardRequest): Promise<ShareResult> {
    if (isSharing.value) return { kind: 'cancelled' }
    isSharing.value = true
    lastError.value = null
    try {
      const blob = await renderCardOffscreen(req)
      const filename = defaultShareFilename(req.summary.rawDate, req.format)
      downloadBlob(blob, filename)
      return { kind: 'downloaded', filename }
    } catch (err) {
      lastError.value = err as Error
      return { kind: 'error', error: err as Error }
    } finally {
      isSharing.value = false
    }
  }

  return { shareCard, downloadCard, isSharing, lastError }
}
