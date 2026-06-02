import { describe, it, expect } from 'vitest'
import {
  defaultShareFilename,
  PREVIEW_SIZE,
  EXPORT_PIXEL_RATIO,
  WATERMARK_TEXT,
  createWatermarkElement,
} from '../shareImage'

describe('shareImage', () => {
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

    it('inlines positioning styles so they survive html-to-image cloning', () => {
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
