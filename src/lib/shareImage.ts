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
 * The node is expected to be already mounted in the DOM. The caller's
 * positioning (typically `position:absolute; left:-10000px` to keep it
 * offscreen) is overridden via the `style` option below — html-to-image
 * preserves the cloned element's positioning into its SVG foreignObject,
 * and a clone with `left: -10000px` renders entirely outside the SVG
 * viewport, producing a transparent PNG. Forcing the clone to render at
 * (0,0) inside the foreignObject is what we want.
 */
export async function renderNodeToBlob(node: HTMLElement, opts: ExportOptions): Promise<Blob> {
  const blob = await toBlob(node, {
    width: opts.width,
    height: opts.height,
    pixelRatio: opts.pixelRatio ?? EXPORT_PIXEL_RATIO,
    cacheBust: true,
    backgroundColor: undefined,
    style: {
      position: 'static',
      left: 'auto',
      top: 'auto',
      right: 'auto',
      bottom: 'auto',
      transform: 'none',
      margin: '0',
    },
  })
  if (!blob) throw new Error('html-to-image returned null blob')
  return blob
}

/**
 * Free-tier branding stamped onto share cards (issue #601). Supporters get
 * clean cards; everyone else gets this small mark in the corner. Keeping the
 * text and styling here (rather than in each of the 11 card templates) means
 * there is a single injection point shared by the export pipeline and the
 * picker preview, so what the user previews is exactly what ships.
 */
export const WATERMARK_TEXT = 'Made with Lift'

/**
 * The app's public URL, stamped onto every share card so a viewer who sees a
 * card on social has a path to find and install the app (issue #714). This
 * closes the organic-acquisition loop: the supporter-gated watermark (#601)
 * establishes attribution, this handle is the actual conversion mechanism, so
 * unlike the watermark it appears on every card regardless of entitlement.
 *
 * Single source of truth — the real deployment domain per CLAUDE.md. Never
 * fabricate or guess this value; the metaRegression suite pins it.
 */
export const SHARE_CARD_HANDLE = 'spa-rho-sandy.vercel.app'

/**
 * Build the watermark element used by the offscreen export pipeline.
 *
 * Styles are inlined (not class-based) so they survive `html-to-image`'s
 * clone-and-rehome step, which strips selectors that don't match in the
 * cloned subtree. Positioned absolute in the bottom-right corner of the
 * card's `position:relative` host.
 *
 * The color is intentionally a fixed semi-transparent white with a drop
 * shadow rather than a theme variable: this mark is baked into an exported
 * image that sits over arbitrary (often bold/dark) card backgrounds, so it
 * needs to read on anything. A theme var like `--text-on-accent` can resolve
 * to a dark color on light themes and vanish. This is the conventional
 * social-watermark treatment, not app chrome.
 */
export function createWatermarkElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.textContent = WATERMARK_TEXT
  el.setAttribute('data-share-watermark', '')
  el.style.cssText = [
    'position:absolute',
    'right:14px',
    'bottom:12px',
    'z-index:10',
    'pointer-events:none',
    'font-family:var(--ff-mono, ui-monospace, monospace)',
    'font-size:11px',
    'font-weight:600',
    'letter-spacing:0.06em',
    'color:rgba(255,255,255,0.85)',
    'text-shadow:0 1px 3px rgba(0,0,0,0.5)',
  ].join(';')
  return el
}

/**
 * Build a default `share-summary-YYYY-MM-DD.png` filename.
 * Used for the download fallback path on browsers without `navigator.share`.
 */
export function defaultShareFilename(rawDate: string, format: CardFormat = 'square'): string {
  const suffix = format === 'story' ? '-story' : ''
  return `lift-${rawDate}${suffix}.png`
}
