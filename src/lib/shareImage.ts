/**
 * DOM → PNG rasterization helper for share cards (issue #305).
 *
 * Cards are designed at a small "preview" size (360×360 / 360×640) and then
 * rasterized at a higher pixelRatio to produce social-platform-sized PNGs
 * (1080×1080 for IG square, 1080×1920 for IG Story). Designing at a small
 * size keeps the markup readable and matches the handoff prototype, while
 * the pixelRatio multiplier produces the resolution platforms expect.
 */

import { toBlob } from 'html-to-image'

export type CardFormat = 'square' | 'story'

export interface ExportOptions {
  /** Preview width in CSS pixels. */
  width: number
  /** Preview height in CSS pixels. */
  height: number
  /** Multiplier applied to width × height for the exported PNG. */
  pixelRatio?: number
}

/** Default sizes — match the handoff design. */
export const PREVIEW_SIZE: Record<CardFormat, { width: number; height: number }> = {
  square: { width: 360, height: 360 },
  story: { width: 360, height: 640 },
}

export const EXPORT_PIXEL_RATIO = 3 // 360 → 1080, 640 → 1920

/**
 * Render a single DOM node to a PNG Blob at high pixel density.
 *
 * The node is expected to be already mounted in the DOM (offscreen is fine —
 * `position: absolute; left: -10000px;` is the typical setup). All assets
 * (fonts, theme variables, gradients) must be loaded before calling.
 */
export async function renderNodeToBlob(node: HTMLElement, opts: ExportOptions): Promise<Blob> {
  const blob = await toBlob(node, {
    width: opts.width,
    height: opts.height,
    pixelRatio: opts.pixelRatio ?? EXPORT_PIXEL_RATIO,
    cacheBust: true,
    backgroundColor: undefined,
  })
  if (!blob) throw new Error('html-to-image returned null blob')
  return blob
}

/**
 * Build a default `share-summary-YYYY-MM-DD.png` filename.
 * Used for the download fallback path on browsers without `navigator.share`.
 */
export function defaultShareFilename(rawDate: string, format: CardFormat = 'square'): string {
  const suffix = format === 'story' ? '-story' : ''
  return `lift-${rawDate}${suffix}.png`
}
