import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock modern-screenshot's domToBlob so we can assert the option mapping
// without a real DOM rasterizer. Pins the html-to-image → modern-screenshot
// migration (#812): `pixelRatio` → `scale`, `cacheBust` → `fetch.bypassingCache`.
const mockDomToBlob = vi.fn<() => Promise<Blob>>(() => Promise.resolve(new Blob()))
vi.mock('modern-screenshot', () => ({
  domToBlob: (...args: unknown[]) => mockDomToBlob(...(args as [])),
}))

import {
  defaultShareFilename,
  PREVIEW_SIZE,
  EXPORT_PIXEL_RATIO,
  WATERMARK_TEXT,
  createWatermarkElement,
  renderNodeToBlob,
} from '../shareImage'

describe('shareImage', () => {
  describe('renderNodeToBlob', () => {
    beforeEach(() => {
      mockDomToBlob.mockClear()
    })

    it('rasterizes via modern-screenshot domToBlob with mapped options', async () => {
      const node = document.createElement('div')
      await renderNodeToBlob(node, { width: 360, height: 640 })

      expect(mockDomToBlob).toHaveBeenCalledTimes(1)
      const [passedNode, opts] = mockDomToBlob.mock.calls[0] as [HTMLElement, Record<string, unknown>]
      expect(passedNode).toBe(node)
      expect(opts.width).toBe(360)
      expect(opts.height).toBe(640)
      // pixelRatio defaults to EXPORT_PIXEL_RATIO and maps to `scale`.
      expect(opts.scale).toBe(EXPORT_PIXEL_RATIO)
      // cacheBust maps to modern-screenshot's fetch.bypassingCache.
      expect(opts.fetch).toEqual({ bypassingCache: true })
      // Transparent background so card corners aren't filled.
      expect(opts.backgroundColor).toBeNull()
    })

    it('honors an explicit pixelRatio override via the scale option', async () => {
      await renderNodeToBlob(document.createElement('div'), {
        width: 100,
        height: 100,
        pixelRatio: 2,
      })
      const [, opts] = mockDomToBlob.mock.calls[0] as [HTMLElement, Record<string, unknown>]
      expect(opts.scale).toBe(2)
    })
  })

  describe('defaultShareFilename', () => {
    it('builds a YYYY-MM-DD prefixed filename for square format', () => {
      expect(defaultShareFilename('2026-04-21')).toBe('lift-2026-04-21.png')
    })

    it('appends -story for vertical format', () => {
      expect(defaultShareFilename('2026-04-21', 'story')).toBe('lift-2026-04-21-story.png')
    })
  })

  describe('PREVIEW_SIZE', () => {
    it('exposes 360x360 for square (rasterizes to 1080x1080 at 3x)', () => {
      expect(PREVIEW_SIZE.square.width).toBe(360)
      expect(PREVIEW_SIZE.square.height).toBe(360)
      expect(PREVIEW_SIZE.square.width * EXPORT_PIXEL_RATIO).toBe(1080)
    })

    it('exposes 360x640 for story (rasterizes to 1080x1920 at 3x)', () => {
      expect(PREVIEW_SIZE.story.width).toBe(360)
      expect(PREVIEW_SIZE.story.height).toBe(640)
      expect(PREVIEW_SIZE.story.height * EXPORT_PIXEL_RATIO).toBe(1920)
    })
  })

  describe('createWatermarkElement', () => {
    it('renders the watermark text', () => {
      expect(createWatermarkElement().textContent).toBe(WATERMARK_TEXT)
    })

    it('tags the element with a data attribute for lookup', () => {
      expect(createWatermarkElement().hasAttribute('data-share-watermark')).toBe(true)
    })

    it('inlines positioning styles so they survive modern-screenshot cloning', () => {
      // Class-based styles are stripped in the cloned subtree; inline styles
      // are not. The watermark must be anchored bottom-right and non-interactive.
      const { style } = createWatermarkElement()
      expect(style.position).toBe('absolute')
      expect(style.right).toBe('14px')
      expect(style.bottom).toBe('12px')
      expect(style.pointerEvents).toBe('none')
    })
  })
})
