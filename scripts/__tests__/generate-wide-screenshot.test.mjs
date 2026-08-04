// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePNG, encodePNG, resize } from '../generate-wide-screenshot.js'

/**
 * Behavioral coverage for the wide-manifest-screenshot generator (#1064).
 *
 * The generator has no native/image deps — it hand-rolls a minimal PNG
 * encoder/decoder and a box-average downscaler. These tests pin the codec
 * round-trip and the downscale contract, then verify the committed
 * public/screenshot-wide.png the manifest points at is a well-formed
 * 1920x1080 landscape PNG (Chromium's richer install dialog requires a
 * wide screenshot to render the carousel instead of the minimal prompt).
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(__dirname, '..', '..', 'public')

describe('generate-wide-screenshot codec', () => {
  it('encode → decode round-trips exact RGBA pixels', () => {
    const width = 2
    const height = 2
    // Distinct, non-symmetric pixels so a transposed/mis-strided decode would fail.
    const pixels = new Uint8Array([
      10, 20, 30, 255, 40, 50, 60, 255,
      70, 80, 90, 255, 100, 110, 120, 200,
    ])
    const png = encodePNG(width, height, pixels)
    // Valid PNG signature.
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    const decoded = decodePNG(png)
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(Array.from(decoded.data)).toEqual(Array.from(pixels))
  })

  it('resize preserves a solid color while halving dimensions', () => {
    const src = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) }
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 12
      src.data[i + 1] = 34
      src.data[i + 2] = 56
      src.data[i + 3] = 255
    }
    const out = resize(src, 2, 2)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    // Box average of a uniform region is the same color.
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(12)
      expect(out.data[i + 1]).toBe(34)
      expect(out.data[i + 2]).toBe(56)
      expect(out.data[i + 3]).toBe(255)
    }
  })
})

describe('committed wide screenshot asset', () => {
  const widePath = resolve(PUBLIC, 'screenshot-wide.png')

  it('exists in public/', () => {
    expect(existsSync(widePath)).toBe(true)
  })

  it('is a valid 1920x1080 landscape PNG', () => {
    const decoded = decodePNG(readFileSync(widePath))
    expect(decoded.width).toBe(1920)
    expect(decoded.height).toBe(1080)
    // Landscape orientation is the whole point — Chromium keys the carousel off it.
    expect(decoded.width).toBeGreaterThan(decoded.height)
  })
})
