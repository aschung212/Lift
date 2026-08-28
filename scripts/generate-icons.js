#!/usr/bin/env node
/**
 * Generates the PWA PNG icons using only Node.js built-ins.
 *
 * The icons are DERIVED from `public/icon-source.png` — the designed gold
 * barbell + arrow art (committed 2026-03-31) — by decoding it and box-filter
 * downscaling to each target size, then encoding with the hand-rolled PNG
 * encoder below (#1114: adaptive scanline filtering + max deflate, indexed
 * when ≤256 colours). The icons are never drawn in code: PR #1120 regenerated
 * them from a hardcoded placeholder drawing this script still carried from
 * March 27, silently reverting the shipped design (#1154). Deriving from the
 * committed source art makes it the single source of truth — re-running the
 * generator reproduces the design instead of clobbering it.
 *
 * Run with: node scripts/generate-icons.js
 */

// ESM: the package is `"type": "module"`, so this script uses import syntax
// (CommonJS `require` throws `ReferenceError` under the current Node/package config).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG encoder ──────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body    = Buffer.concat([typeBuf, data]);
  const crcBuf  = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(body));
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function makeIHDR(width, height, bitDepth, colorType) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = ihdr[11] = ihdr[12] = 0; // deflate / adaptive filtering / no interlace
  return ihdr;
}

function paeth(a, b, c) {
  const p  = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Filter `rows` (one Uint8Array/Buffer per scanline, each `stride` bytes) choosing
// the best of the five PNG filter types per row via libpng's minimum-sum-of-
// absolute-differences heuristic. `bpp` is the byte distance to the left pixel.
// Solid regions collapse to runs of zeros, which deflate compresses far better
// than the previous fixed filter-None output.
function filterScanlines(rows, stride, bpp) {
  const height = rows.length;
  const zero   = new Uint8Array(stride);
  const cand   = [0, 1, 2, 3, 4].map(() => Buffer.allocUnsafe(stride));
  const out    = Buffer.allocUnsafe((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const cur  = rows[y];
    const prev = y > 0 ? rows[y - 1] : zero;

    for (let i = 0; i < stride; i++) {
      const x = cur[i];
      const a = i >= bpp ? cur[i - bpp]  : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      cand[0][i] = x;
      cand[1][i] = (x - a) & 255;
      cand[2][i] = (x - b) & 255;
      cand[3][i] = (x - ((a + b) >> 1)) & 255;
      cand[4][i] = (x - paeth(a, b, c)) & 255;
    }

    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const v = cand[f][i];
        score += v < 128 ? v : 256 - v; // treat bytes as signed magnitudes
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }

    const ro = y * (stride + 1);
    out[ro] = best;
    cand[best].copy(out, ro + 1);
  }

  return out;
}

function encodePNG(width, height, pixels) {
  // These icons are flat two-colour art (a barbell over a solid background), so
  // anti-aliasing only ever produces blends between those two colours — a handful
  // of distinct RGBA values. When ≤256 unique colours exist we emit a colour-type-3
  // indexed PNG (1 byte/pixel + a tiny PLTE) instead of 32-bit truecolour, which —
  // combined with adaptive filtering and max deflate — shrinks the precached icons
  // by ~5× losslessly. Truecolour remains the fallback for richer inputs.
  const paletteIndex = new Map();
  const palette = [];
  let indexable = true;

  for (let p = 0; p < width * height; p++) {
    const s = p * 4;
    const key = (pixels[s] << 24) | (pixels[s + 1] << 16) | (pixels[s + 2] << 8) | pixels[s + 3];
    if (!paletteIndex.has(key)) {
      if (palette.length >= 256) { indexable = false; break; }
      paletteIndex.set(key, palette.length);
      palette.push([pixels[s], pixels[s + 1], pixels[s + 2], pixels[s + 3]]);
    }
  }

  const extraChunks = [];
  let ihdr, filtered;

  if (indexable) {
    const rows = [];
    for (let y = 0; y < height; y++) {
      const row = Buffer.allocUnsafe(width);
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4;
        const key = (pixels[s] << 24) | (pixels[s + 1] << 16) | (pixels[s + 2] << 8) | pixels[s + 3];
        row[x] = paletteIndex.get(key);
      }
      rows.push(row);
    }
    filtered = filterScanlines(rows, width, 1);
    ihdr = makeIHDR(width, height, 8, 3); // 8-bit indexed

    const plte = Buffer.allocUnsafe(palette.length * 3);
    let hasAlpha = false;
    for (let i = 0; i < palette.length; i++) {
      plte[i * 3]     = palette[i][0];
      plte[i * 3 + 1] = palette[i][1];
      plte[i * 3 + 2] = palette[i][2];
      if (palette[i][3] !== 255) hasAlpha = true;
    }
    extraChunks.push(pngChunk('PLTE', plte));
    if (hasAlpha) {
      const trns = Buffer.allocUnsafe(palette.length);
      for (let i = 0; i < palette.length; i++) trns[i] = palette[i][3];
      extraChunks.push(pngChunk('tRNS', trns)); // PLTE then tRNS, both before IDAT
    }
  } else {
    const stride = width * 4;
    const rows = [];
    for (let y = 0; y < height; y++) rows.push(pixels.subarray(y * stride, (y + 1) * stride));
    filtered = filterScanlines(rows, stride, 4);
    ihdr = makeIHDR(width, height, 8, 6); // 8-bit RGBA
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    ...extraChunks,
    pngChunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── PNG decoder ──────────────────────────────────────────────────────────────
// Minimal decoder for the source art and for round-trip verification in tests:
// 8-bit, non-interlaced PNGs of colour type 2 (RGB), 3 (indexed, optional
// tRNS), or 6 (RGBA) — the three shapes this pipeline produces or consumes.
// Returns { width, height, colorType, rgba } with rgba flattened to 4 bytes
// per pixel.
function decodePNG(buf) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < SIG.length; i++) {
    if (buf[i] !== SIG[i]) throw new Error('bad PNG signature');
  }
  let o = 8;
  let width, height, bitDepth, colorType, interlace;
  let palette = null;
  let trns = null;
  const idat = [];
  while (o < buf.length) {
    const len  = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = [];
      for (let i = 0; i < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || ![2, 3, 6].includes(colorType)) {
    throw new Error(`unsupported PNG (depth=${bitDepth} colorType=${colorType} interlace=${interlace})`);
  }

  const bpp    = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const raw    = zlib.inflateSync(Buffer.concat(idat));
  const rows   = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const ri = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const x = raw[ri + i];
      const a = i >= bpp ? rows[y * stride + i - bpp] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? rows[(y - 1) * stride + i - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`unknown scanline filter ${ft}`);
      }
      rows[y * stride + i] = v & 255;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    if (colorType === 6) {
      rgba[p * 4]     = rows[p * 4];
      rgba[p * 4 + 1] = rows[p * 4 + 1];
      rgba[p * 4 + 2] = rows[p * 4 + 2];
      rgba[p * 4 + 3] = rows[p * 4 + 3];
    } else if (colorType === 2) {
      rgba[p * 4]     = rows[p * 3];
      rgba[p * 4 + 1] = rows[p * 3 + 1];
      rgba[p * 4 + 2] = rows[p * 3 + 2];
      rgba[p * 4 + 3] = 255;
    } else {
      const [r, g, b] = palette[rows[p]];
      rgba[p * 4]     = r;
      rgba[p * 4 + 1] = g;
      rgba[p * 4 + 2] = b;
      rgba[p * 4 + 3] = trns && rows[p] < trns.length ? trns[rows[p]] : 255;
    }
  }
  return { width, height, colorType, rgba };
}

// ── Resampler ────────────────────────────────────────────────────────────────
// Area-weighted box downscale: each destination pixel averages the exact
// (fractional) source window it covers. Pure arithmetic on IEEE-754 doubles, so
// the output is byte-identical across platforms — the committed-equals-generated
// drift test in scripts/__tests__/generate-icons.test.mjs depends on that.
function resampleBox(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  const xr = sw / dw;
  const yr = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * yr, y1 = y0 + yr;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * xr, x1 = x0 + xr;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const w = wx * wy;
          const s = (sy * sw + sx) * 4;
          r += src[s] * w;
          g += src[s + 1] * w;
          b += src[s + 2] * w;
          a += src[s + 3] * w;
          area += w;
        }
      }
      const o = (dy * dw + dx) * 4;
      out[o]     = Math.round(r / area);
      out[o + 1] = Math.round(g / area);
      out[o + 2] = Math.round(b / area);
      out[o + 3] = Math.round(a / area);
    }
  }
  return out;
}

// ── Icon renderer ────────────────────────────────────────────────────────────
// Renders by downscaling the committed source art — see the header comment for
// why this must never be replaced with in-code drawing (#1154).
const SOURCE_ART = path.resolve(__dirname, '..', 'public', 'icon-source.png');

let _sourceArt = null;
function loadSourceArt() {
  if (!_sourceArt) _sourceArt = decodePNG(fs.readFileSync(SOURCE_ART));
  return _sourceArt;
}

/**
 * Render the icon at the given size by area-average downscaling the source art.
 */
function renderIcon(size) {
  const src = loadSourceArt();
  return resampleBox(src.rgba, src.width, src.height, size, size);
}

export { encodePNG, decodePNG, resampleBox, renderIcon };

// ── Output (CLI only) ─────────────────────────────────────────────────────────
// Guarded so tests can import the pure encoder without writing files on import.
function main() {
  const PUBLIC = path.resolve(__dirname, '..', 'public');
  fs.mkdirSync(PUBLIC, { recursive: true });

  const SIZES = [
    { name: 'icon-192.png',          size: 192 },
    { name: 'icon-512.png',          size: 512 },
    { name: 'apple-touch-icon.png',  size: 180 },
  ];

  for (const { name, size } of SIZES) {
    process.stdout.write(`  generating ${name} (${size}×${size}) ... `);
    fs.writeFileSync(path.join(PUBLIC, name), encodePNG(size, size, renderIcon(size)));
    console.log('done');
  }

  console.log(`\nIcons written to ${PUBLIC}/`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
