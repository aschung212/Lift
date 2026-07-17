/**
 * Orchestrates the share flow for issue #305 share cards:
 *   1. Mount a card component offscreen (detached Vue app, no Pinia needed —
 *      cards are pure presentational components that take a typed summary prop).
 *   2. Wait for the next tick so the DOM and CSS are settled, then rasterize
 *      the card to a PNG Blob via `modern-screenshot`.
 *   3. Share via the native iOS share sheet (Capacitor), the Web Share API
 *      (browser, iOS Safari 16.4+ supports image files), or fall back to a
 *      direct download — same Blob → URL.createObjectURL pattern App.vue
 *      already uses for CSV/JSON exports.
 *   4. Always unmount and revoke the object URL.
 */

import { ref, createApp, h, type Component, type Ref, nextTick } from 'vue'
import {
  renderNodeToBlob,
  createWatermarkElement,
  defaultShareFilename,
  PREVIEW_SIZE,
  EXPORT_PIXEL_RATIO,
  type CardFormat,
} from '../lib/shareImage'
import type { SessionSummary } from '../lib/sessionSummary'
import { useAnalytics } from './useAnalytics'
import { APP_URL, APP_TAGLINE } from '../lib/appMeta'

/** Title shown in the share sheet for a rasterized workout card. */
const SHARE_TITLE = 'Lift workout'

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
  /**
   * Stamp the free-tier "Made with Lift" watermark onto the rendered card.
   * Set by the caller from the supporter entitlement (#601). Defaults to
   * off so callers must opt in explicitly.
   */
  watermark?: boolean
}

export type ShareResult =
  | { kind: 'shared' }                   // native sheet / Web Share resolved
  | { kind: 'downloaded'; filename: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; error: Error }

/**
 * Pick the richest Web Share payload a platform will actually accept for a
 * rendered card. We prefer a payload that carries both the card image AND a
 * tappable link back to the app (#794) so a recipient can convert in one tap
 * instead of retyping the printed handle — but some platforms reject a
 * files+url combo via `canShare`, so we degrade to image-only rather than
 * drop the share entirely. Returns null when no payload is sharable (caller
 * falls back to download).
 *
 * iOS Safari 16.4+ and Android Chrome both report `canShare({ files })` as true.
 */
function pickWebSharePayload(file: File): ShareData | null {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return null
  const withLink: ShareData = { files: [file], title: SHARE_TITLE, text: APP_TAGLINE, url: APP_URL }
  const imageOnly: ShareData = { files: [file], title: SHARE_TITLE }
  try {
    if (navigator.canShare(withLink)) return withLink
    if (navigator.canShare(imageOnly)) return imageOnly
  } catch {
    return null
  }
  return null
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
/**
 * The list of theme custom properties consumed by share cards. Snapshotted
 * from the live document at render time and inlined onto the offscreen
 * host so theme variables resolve inside `modern-screenshot`'s cloned subtree
 * (where the original `[data-theme="X"][data-mode="Y"]` selectors don't
 * reliably match — the clone lives outside the original cascade).
 */
const THEME_VAR_NAMES = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-elevated',
  '--bg-hover',
  '--border',
  '--border-strong',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-on-accent',
  '--accent',
  '--accent-hover',
  '--accent-subtle',
  '--pr',
  '--pr-subtle',
  '--mesh',
  '--ff',
  '--ff-display',
  '--ff-mono',
] as const

function snapshotThemeVars(): string {
  const root = getComputedStyle(document.documentElement)
  const decls: string[] = []
  for (const name of THEME_VAR_NAMES) {
    const value = root.getPropertyValue(name).trim()
    if (value) decls.push(`${name}:${value}`)
  }
  return decls.join(';')
}

async function renderCardOffscreen(req: ShareCardRequest): Promise<Blob> {
  const { width, height } = PREVIEW_SIZE[req.format]
  const host = document.createElement('div')
  // Offscreen but rendered: modern-screenshot needs the node in the DOM with
  // real layout. Inline the resolved theme variables onto the host so they
  // survive modern-screenshot's clone-and-rehome step (the `[data-theme=…]` selectors
  // don't reliably match in the cloned subtree, which leaves the rasterized
  // image blank). Explicit `position: relative` on the inner provides the
  // containing block for cards' absolute children.
  host.style.cssText =
    `position:absolute;left:-10000px;top:0;width:${width}px;height:${height}px;` +
    `pointer-events:none;` +
    snapshotThemeVars()
  host.setAttribute('data-theme', req.theme)
  host.setAttribute('data-mode', req.mode)

  const inner = document.createElement('div')
  inner.style.cssText = `position:relative;width:${width}px;height:${height}px;`
  host.appendChild(inner)

  document.body.appendChild(host)
  const app = createApp({
    render: () => h(req.component, { summary: req.summary }),
  })

  try {
    app.mount(inner)
    // Stamp the watermark on top of the mounted card. `inner` is the
    // position:relative containing block, so the absolute watermark anchors
    // to the card's bottom-right corner.
    if (req.watermark) inner.appendChild(createWatermarkElement())
    // Two ticks: first to flush mount, second to flush any computed/CSS
    // recalculation triggered by the freshly-applied theme vars.
    await nextTick()
    await nextTick()
    return await renderNodeToBlob(host, { width, height, pixelRatio: EXPORT_PIXEL_RATIO })
  } finally {
    app.unmount()
    host.remove()
  }
}

export interface UseWorkoutShareReturn {
  shareCard: (req: ShareCardRequest) => Promise<ShareResult>
  downloadCard: (req: ShareCardRequest) => Promise<ShareResult>
  isSharing: Ref<boolean>
  lastError: Ref<Error | null>
}

export function useWorkoutShare(): UseWorkoutShareReturn {
  const isSharing = ref(false)
  const lastError = ref<Error | null>(null)
  const { logEvent } = useAnalytics()

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

      const sharePayload = pickWebSharePayload(file)
      if (sharePayload) {
        try {
          await navigator.share(sharePayload)
          logEvent('share_completed', { format: req.format, method: 'share', outcome: 'shared' })
          return { kind: 'shared' }
        } catch (err) {
          // AbortError = user dismissed sheet. Anything else falls to download.
          if ((err as DOMException).name === 'AbortError') return { kind: 'cancelled' }
        }
      }

      downloadBlob(blob, filename)
      logEvent('share_completed', { format: req.format, method: 'share', outcome: 'downloaded' })
      return { kind: 'downloaded', filename }
    } catch (err) {
      lastError.value = err as Error
      logEvent('share_failed', { format: req.format, method: 'share' })
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
      logEvent('share_completed', { format: req.format, method: 'save', outcome: 'downloaded' })
      return { kind: 'downloaded', filename }
    } catch (err) {
      lastError.value = err as Error
      logEvent('share_failed', { format: req.format, method: 'save' })
      return { kind: 'error', error: err as Error }
    } finally {
      isSharing.value = false
    }
  }

  return { shareCard, downloadCard, isSharing, lastError }
}
