// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG, decodePNG, resampleBox, renderIcon } from '../generate-icons.js'

/**
 * Behavioral coverage for the PWA icon generator (#1114, reworked in #1154).
 *
 * Two failure classes are pinned here:
 *
 * 1. **Encoder regressions (#1114).** The generator hand-rolls a PNG encoder
 *    (indexed when ≤256 colours, adaptive scanline filtering, max deflate).
 *    These tests pin that it is lossless on both paths and that the committed
 *    icons stay within a size budget, so a regression to unoptimised output
 *    fails CI.
 *
 * 2. **Art regressions (#1154).** PR #1120 re-ran this generator while it still
 *    drew a hardcoded March-27 placeholder (flat red dumbbell), silently
 *    replacing the designed gold barbell+arrow icons that had shipped since
 *    2026-03-31 — and every test passed, because nothing tied the committed
 *    icons to the design source. The generator now DERIVES icons from
 *    `public/icon-source.png`, and the tests below pin (a) that the committed
 *    icons decode pixel-identical to the generator's output (drift guard, byte
 *    comparisons deliberately avoided so zlib version differences can't flake
 *    it), and (b) that the art is the rich gradient design, not a flat
 *    placeholder.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(__dirname, '..', '..', 'public')

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

function uniqueColors(rgba) {
  const set = new Set()
  for (let i = 0; i < rgba.length; i += 4) {
    set.add((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | rgba[i + 3])
  }
  return set.size
}

describe('generate-icons PNG encoder', () => {
  it('round-trips a small ≤256-colour bitmap losslessly via the indexed path', () => {
    const w = 4, h = 3
    const A = [26, 26, 26, 255]
    const B = [255, 99, 99, 255]
    const pixels = new Uint8Array(w * h * 4)
    for (let p = 0; p < w * h; p++) {
      const c = p % 2 === 0 ? A : B
      pixels.set(c, p * 4)
    }
    const png = encodePNG(w, h, pixels)
    const dec = decodePNG(png)
    expect(dec.width).toBe(w)
    expect(dec.height).toBe(h)
    expect(dec.colorType).toBe(3) // indexed
    expect(Array.from(dec.rgba)).toEqual(Array.from(pixels))
  })

  it('falls back to lossless truecolour when >256 unique colours exist', () => {
    const w = 20, h = 20 // 400 pixels < 512, so (p%256, p>>8) is unique per pixel
    const pixels = new Uint8Array(w * h * 4)
    for (let p = 0; p < w * h; p++) {
      pixels[p * 4] = p % 256
      pixels[p * 4 + 1] = p >> 8
      pixels[p * 4 + 2] = 0
      pixels[p * 4 + 3] = 255
    }
    const dec = decodePNG(encodePNG(w, h, pixels))
    expect(dec.colorType).toBe(6) // truecolour fallback
    expect(Array.from(dec.rgba)).toEqual(Array.from(pixels))
  })

  it('preserves per-pixel alpha through the indexed path via a tRNS chunk', () => {
    const w = 2, h = 2
    const pixels = new Uint8Array([
      10, 20, 30, 255, 40, 50, 60, 128,
      70, 80, 90, 0, 100, 110, 120, 200,
    ])
    const png = encodePNG(w, h, pixels)
    expect(png.includes(Buffer.from('tRNS', 'ascii'))).toBe(true)
    // The decoder honours tRNS, so the full RGBA round-trips exactly.
    expect(Array.from(decodePNG(png).rgba)).toEqual(Array.from(pixels))
  })
})

describe('icons derive from the committed source art (#1154)', () => {
  const source = decodePNG(readFileSync(resolve(PUBLIC, 'icon-source.png')))

  it('the source art is the rich gradient design, not a flat placeholder', () => {
    expect(source.width).toBe(1024)
    expect(source.height).toBe(1024)
    // The March-27 placeholder rendered ≤17 unique colours; the designed gold
    // barbell+arrow has thousands. This is the tripwire that would have caught
    // #1120 swapping the art.
    expect(uniqueColors(source.rgba)).toBeGreaterThan(256)
  })

  it('renderIcon output is a downscale of the source, not an in-code drawing', () => {
    const size = 64
    const rendered = renderIcon(size)
    const reference = resampleBox(source.rgba, source.width, source.height, size, size)
    expect(Array.from(rendered)).toEqual(Array.from(reference))
  })

  for (const [name, size] of [
    ['icon-512.png', 512],
    ['icon-192.png', 192],
    ['apple-touch-icon.png', 180],
  ]) {
    it(`${name} decodes pixel-identical to the generator output (no drift)`, () => {
      // Pixel comparison, not byte comparison: IDAT bytes may vary across zlib
      // versions, but the decoded art must be exactly what the generator
      // produces from icon-source.png. If this fails, someone changed the
      // source art or the pipeline without regenerating (or vice versa) — run
      // `npm run generate-icons` and commit the result.
      const committed = decodePNG(readFileSync(resolve(PUBLIC, name)))
      expect(committed.width).toBe(size)
      expect(committed.height).toBe(size)
      expect(Buffer.from(committed.rgba).equals(Buffer.from(renderIcon(size)))).toBe(true)
    })

    it(`${name} carries the designed art (rich palette, not a placeholder)`, () => {
      const committed = decodePNG(readFileSync(resolve(PUBLIC, name)))
      expect(uniqueColors(committed.rgba)).toBeGreaterThan(256)
    })
  }
})

describe('committed public PWA icons stay small (precache budget)', () => {
  // Budgets are calibrated to the DESIGNED art encoded losslessly with the
  // #1114 encoder (adaptive filtering + max deflate): ~236KB / ~35KB / ~31KB.
  // They exist to catch encoder regressions (e.g. a return to filter-None
  // unoptimised output, which costs 2-4× more) — NOT to force the art itself
  // to stay trivial: #1120 "won" its 248KB→3KB shrink mostly by replacing the
  // gradient design with flat placeholder art, which is exactly the trade
  // these tests no longer allow to happen silently.
  const budgets = [
    ['icon-512.png', 300 * 1024],
    ['icon-192.png', 48 * 1024],
    ['apple-touch-icon.png', 44 * 1024],
  ]
  for (const [name, max] of budgets) {
    it(`${name} is well-formed and under ${Math.round(max / 1024)}KB`, () => {
      const buf = readFileSync(resolve(PUBLIC, name))
      for (let i = 0; i < SIG.length; i++) expect(buf[i]).toBe(SIG[i])
      expect(statSync(resolve(PUBLIC, name)).size).toBeLessThan(max)
    })
  }
})
