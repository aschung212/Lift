// @ts-nocheck
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG, renderIcon } from '../generate-icons.js'

/**
 * Behavioral coverage for the PWA icon generator (#1114).
 *
 * The generator hand-rolls a PNG encoder with no native deps. #1114 rebuilt that
 * encoder to emit colour-type-3 indexed PNGs with adaptive scanline filtering and
 * max deflate for the flat two-colour barbell art, shrinking icon-512.png from
 * ~248KB to a few KB — a payload that every installed PWA user downloads in the
 * service-worker precache. These tests pin (1) that the encoder is lossless on
 * both the indexed and truecolour paths, (2) that it actually picks the indexed
 * path for the icon art, and (3) that the committed public icons stay small so a
 * regression back to bloated truecolour output fails CI.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(__dirname, '..', '..', 'public')

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

// Minimal PNG decoder supporting the two colour types this encoder emits:
// type 3 (8-bit indexed + PLTE) and type 6 (8-bit RGBA). Returns width/height,
// the IHDR colour type, and the flattened RGBA pixel buffer.
function decodePNG(buf) {
  for (let i = 0; i < SIG.length; i++) {
    if (buf[i] !== SIG[i]) throw new Error('bad PNG signature')
  }
  let o = 8
  let width, height, bitDepth, colorType
  let palette = null
  const idat = []
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('ascii', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'PLTE') {
      palette = []
      for (let i = 0; i < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]])
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    o += 12 + len
  }

  const bpp = colorType === 6 ? 4 : 1
  const stride = width * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const rows = Buffer.alloc(stride * height)

  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]
    const ri = y * (stride + 1) + 1
    for (let i = 0; i < stride; i++) {
      const x = raw[ri + i]
      const a = i >= bpp ? rows[y * stride + i - bpp] : 0
      const b = y > 0 ? rows[(y - 1) * stride + i] : 0
      const c = i >= bpp && y > 0 ? rows[(y - 1) * stride + i - bpp] : 0
      let v
      switch (ft) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`unknown filter ${ft}`)
      }
      rows[y * stride + i] = v & 255
    }
  }

  const rgba = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    if (colorType === 6) {
      rgba[p * 4] = rows[p * 4]
      rgba[p * 4 + 1] = rows[p * 4 + 1]
      rgba[p * 4 + 2] = rows[p * 4 + 2]
      rgba[p * 4 + 3] = rows[p * 4 + 3]
    } else {
      const [r, g, bl] = palette[rows[p]]
      rgba[p * 4] = r
      rgba[p * 4 + 1] = g
      rgba[p * 4 + 2] = bl
      rgba[p * 4 + 3] = 255
    }
  }
  return { width, height, bitDepth, colorType, rgba }
}

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
    const dec = decodePNG(encodePNG(w, h, pixels))
    // decoder above forces alpha 255 for indexed, so compare RGB only here and
    // assert the encoder wrote a tRNS chunk so real decoders recover the alpha.
    const png = encodePNG(w, h, pixels)
    expect(png.includes(Buffer.from('tRNS', 'ascii'))).toBe(true)
    for (let p = 0; p < w * h; p++) {
      expect(dec.rgba[p * 4]).toBe(pixels[p * 4])
      expect(dec.rgba[p * 4 + 1]).toBe(pixels[p * 4 + 1])
      expect(dec.rgba[p * 4 + 2]).toBe(pixels[p * 4 + 2])
    }
  })

  it('encodes the rendered barbell icon as a compact indexed PNG', () => {
    const size = 192
    const pixels = renderIcon(size)
    // Flat two-colour art: anti-aliasing only blends the two colours, so the
    // palette stays tiny — this is what makes indexed encoding a huge win.
    expect(uniqueColors(pixels)).toBeLessThanOrEqual(256)
    const png = encodePNG(size, size, pixels)
    expect(decodePNG(png).colorType).toBe(3)
    // Far smaller than the 4 bytes/pixel raw truecolour footprint.
    expect(png.length).toBeLessThan(size * size * 4 * 0.1)
    // Losslessness on the real icon content, not just synthetic bitmaps.
    expect(Array.from(decodePNG(png).rgba)).toEqual(Array.from(pixels))
  })
})

describe('committed public PWA icons stay small (precache budget)', () => {
  // Guards the #1114 shrink: a regression to unoptimised truecolour encoding
  // (icon-512.png was ~248KB) would blow these budgets and fail CI. Budgets sit
  // well above the current few-KB output but far below the old footprint.
  const budgets = [
    ['icon-512.png', 60 * 1024],
    ['icon-192.png', 20 * 1024],
    ['apple-touch-icon.png', 20 * 1024],
  ]
  for (const [name, max] of budgets) {
    it(`${name} is well-formed and under ${Math.round(max / 1024)}KB`, () => {
      const buf = readFileSync(resolve(PUBLIC, name))
      for (let i = 0; i < SIG.length; i++) expect(buf[i]).toBe(SIG[i])
      expect(statSync(resolve(PUBLIC, name)).size).toBeLessThan(max)
    })
  }
})
