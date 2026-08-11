#!/usr/bin/env node
/**
 * Generates PWA PNG icons from scratch using only Node.js built-ins.
 * Renders a barbell icon on a dark background with supersampled anti-aliasing.
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

// ── Icon renderer ────────────────────────────────────────────────────────────
// Barbell design: two weight discs connected by a horizontal bar.
// Background: #1a1a1a  |  Barbell: #ff6363

const BG  = [26,  26,  26];   // dark background
const BAR = [255, 99,  99];   // accent red

/**
 * Returns 1 if the sub-pixel (fx, fy) falls inside the barbell shape, 0 otherwise.
 */
function sampleShape(fx, fy, w, h) {
  const cx = w / 2;
  const cy = h / 2;

  const discR    = w * 0.19;   // weight disc radius
  const discOffX = w * 0.295;  // disc centre offset from icon centre
  const barHalfH = h * 0.065;  // half-height of the connecting bar
  const barHalfW = w * 0.295;  // half-width of the bar (connects to disc centres)

  const lx = cx - discOffX;
  const rx = cx + discOffX;

  if (Math.hypot(fx - lx, fy - cy) <= discR) return 1; // left disc
  if (Math.hypot(fx - rx, fy - cy) <= discR) return 1; // right disc
  if (fx >= lx && fx <= rx && Math.abs(fy - cy) <= barHalfH) return 1; // bar

  return 0;
}

/**
 * Render the icon at the given size using 4×4 supersampled anti-aliasing.
 */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const SS = 4; // samples per axis (16 total per pixel)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          acc += sampleShape(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, size, size);
        }
      }

      const t = acc / (SS * SS); // blend factor (0 = bg, 1 = barbell)
      const i = (py * size + px) * 4;
      pixels[i]     = Math.round(BAR[0] * t + BG[0] * (1 - t));
      pixels[i + 1] = Math.round(BAR[1] * t + BG[1] * (1 - t));
      pixels[i + 2] = Math.round(BAR[2] * t + BG[2] * (1 - t));
      pixels[i + 3] = 255;
    }
  }

  return pixels;
}

export { encodePNG, renderIcon };

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
