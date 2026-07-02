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

import { createApp, h, type Component, type Ref, nextTick } from 'vue'
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
import { useShareFlow, isShareCancellation, type ShareResult } from './useShareFlow'

export type { ShareResult }

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
  const { isSharing, lastError, run } = useShareFlow()
  const { logEvent } = useAnalytics()

  /**
   * Map a terminal share outcome onto the share funnel (#712). Success and
   * download both count as completions; a caught render/share failure is a
   * `share_failed`; a user cancel is deliberately silent.
   */
  function logOutcome(result: ShareResult, format: CardFormat, method: 'share' | 'save'): void {
    if (result.kind === 'shared') {
      logEvent('share_completed', { format, method, outcome: 'shared' })
    } else if (result.kind === 'downloaded') {
      logEvent('share_completed', { format, method, outcome: 'downloaded' })
    } else if (result.kind === 'error') {
      logEvent('share_failed', { format, method })
    }
  }

  /**
   * Render → share. Resolves with the outcome; never throws on user-cancel.
   * Errors during rendering or unexpected share failures resolve as
   * { kind: 'error' } so the caller can surface a toast.
   */
  async function shareCard(req: ShareCardRequest): Promise<ShareResult> {
    const result = await run([
      async () => {
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
            // Cancel = user dismissed sheet. Anything else falls to download.
            if (isShareCancellation(err)) return { kind: 'cancelled' }
          }
        }

        downloadBlob(blob, filename)
        return { kind: 'downloaded', filename }
      },
    ])
    logOutcome(result, req.format, 'share')
    return result
  }

  /** Skip the share sheet and download directly. */
  async function downloadCard(req: ShareCardRequest): Promise<ShareResult> {
    const result = await run([
      async () => {
        const blob = await renderCardOffscreen(req)
        const filename = defaultShareFilename(req.summary.rawDate, req.format)
        downloadBlob(blob, filename)
        return { kind: 'downloaded', filename }
      },
    ])
    logOutcome(result, req.format, 'save')
    return result
  }

  return { shareCard, downloadCard, isSharing, lastError }
}
