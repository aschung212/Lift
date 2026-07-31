/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
// @ts-expect-error - plain JS generator script, no type declarations
import { decodePNG, encodePNG, resize, OUT_W, OUT_H } from '../../../scripts/generate-wide-screenshot.js'

/**
 * Tests for the wide-screenshot generator (LIFT-1064) and its committed output.
 *
 * The generator is a pure Node PNG codec (decode → bilinear downscale → encode)
 * that composites the three narrow phone captures into one landscape manifest
 * screenshot. These tests exercise the codec's correctness (a bad filter or
 * stride bug would silently corrupt the asset) and pin that the committed
 * public/screenshot-wide.png is a valid PNG whose real dimensions match what the
 * manifest advertises — a mismatch makes Chromium reject the screenshot.
 */

const publicDir = resolve(__dirname, '../../../public')

function readPngSize(buf: Buffer): { width: number; height: number } {
  // PNG signature (8) + IHDR length (4) + 'IHDR' (4) → width(4) height(4).
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('wide-screenshot generator', () => {
  it('round-trips pixels through encode → decode without loss', () => {
    const w = 3
    const h = 2
    const src = new Uint8Array([
      // row 0
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
      // row 1
      100, 110, 120, 255, 130, 140, 150, 255, 160, 170, 180, 255,
    ])
    const png = encodePNG(w, h, Buffer.from(src))
    const decoded = decodePNG(png)
    expect(decoded.width).toBe(w)
    expect(decoded.height).toBe(h)
    expect(Array.from(decoded.pixels)).toEqual(Array.from(src))
  })

  it('preserves a solid color when downscaling (no edge bleed)', () => {
    const w = 4
    const h = 4
    const px = new Uint8Array(w * h * 4)
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 200; px[i + 1] = 168; px[i + 2] = 76; px[i + 3] = 255
    }
    const out = resize({ width: w, height: h, pixels: px }, 2, 2)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    for (let i = 0; i < out.pixels.length; i += 4) {
      expect(out.pixels[i]).toBe(200)
      expect(out.pixels[i + 1]).toBe(168)
      expect(out.pixels[i + 2]).toBe(76)
      expect(out.pixels[i + 3]).toBe(255)
    }
  })

  it('exports a landscape target resolution', () => {
    expect(OUT_W).toBeGreaterThan(OUT_H)
  })

  it('committed screenshot-wide.png is a valid PNG matching the target resolution', () => {
    const buf = readFileSync(resolve(publicDir, 'screenshot-wide.png'))
    // PNG magic signature.
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const { width, height } = readPngSize(buf)
    expect(width).toBe(OUT_W)
    expect(height).toBe(OUT_H)
  })

  it("committed asset size matches the manifest's declared sizes", () => {
    const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.js'), 'utf-8')
    const match = viteConfig.match(/src: 'screenshot-wide\.png',\s*\n\s*sizes: '(\d+)x(\d+)'/)
    expect(match).not.toBeNull()
    const [, w, h] = match as RegExpMatchArray
    const buf = readFileSync(resolve(publicDir, 'screenshot-wide.png'))
    const { width, height } = readPngSize(buf)
    expect(width).toBe(Number(w))
    expect(height).toBe(Number(h))
  })
})
