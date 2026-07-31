#!/usr/bin/env node
/**
 * Generates a wide (landscape) PWA manifest screenshot from the existing
 * narrow phone screenshots — pure Node.js built-ins, no native deps.
 *
 * Chromium's richer install dialog (desktop Chrome/Edge and some Android
 * surfaces) only renders the enhanced screenshot-carousel UI when at least one
 * `form_factor: 'wide'` screenshot is present. All of Lift's declared
 * screenshots are `narrow`, so those surfaces fall back to a minimal one-line
 * install prompt (LIFT-1064). This script composites the three portrait phone
 * captures onto a branded Eternal-dark canvas to produce a single wide preview.
 *
 * It decodes the source PNGs (inflate + unfilter), bilinearly downscales each
 * to a device tile, and blits them side-by-side onto the canvas, then re-encodes
 * with the same minimal PNG writer used by generate-launch-screens.js.
 *
 * Output: public/screenshot-wide.png (1920x1080, 16:9).
 * The manifest entry lives in vite.config.js; manifestRegression.test.ts pins
 * both the entry and the file's existence.
 *
 * Run with: node scripts/generate-wide-screenshot.js
 */

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

// ── PNG encoder (8-bit RGBA, filter None) ─────────────────────────────────────
function pngChunk(type, data) {
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(body));
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function encodePNG(width, height, pixels) {
  const rowLen = width * 4;
  const raw = Buffer.allocUnsafe((rowLen + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowLen + 1)] = 0; // filter: None
    pixels.copy
      ? pixels.copy(raw, y * (rowLen + 1) + 1, y * rowLen, y * rowLen + rowLen)
      : raw.set(pixels.subarray(y * rowLen, y * rowLen + rowLen), y * (rowLen + 1) + 1);
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── PNG decoder (8-bit, non-interlaced, color type 2/6) ───────────────────────
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`unsupported color type ${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;

  // Concatenate all IDAT chunk payloads.
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= channels ? cur[x - channels] : 0; // left
      const b = prev[x]; // up
      const c = x >= channels ? prev[x - channels] : 0; // up-left
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[x] = val & 0xff;
    }
    // Expand scanline to RGBA.
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = cur[s];
      out[d + 1] = cur[s + 1];
      out[d + 2] = cur[s + 2];
      out[d + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, pixels: out };
}

// ── Bilinear downscale ────────────────────────────────────────────────────────
function resize(src, dstW, dstH) {
  const { width: sw, height: sh, pixels } = src;
  const out = new Uint8Array(dstW * dstH * 4);
  const sx = sw / dstW;
  const sy = sh / dstH;
  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dstW; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const d = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = pixels[(y0 * sw + x0) * 4 + c];
        const p10 = pixels[(y0 * sw + x1) * 4 + c];
        const p01 = pixels[(y1 * sw + x0) * 4 + c];
        const p11 = pixels[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p10 - p00) * wx;
        const bot = p01 + (p11 - p01) * wx;
        out[d + c] = Math.round(top + (bot - top) * wy);
      }
    }
  }
  return { width: dstW, height: dstH, pixels: out };
}

// ── Canvas helpers ────────────────────────────────────────────────────────────
// Eternal dark palette (matches src/themes/eternal.css dark mode).
const BG_TOP = [18, 18, 20];
const BG_BOTTOM = [8, 8, 9];
const ACCENT = [200, 168, 76]; // --accent #c8a84c

function makeCanvas(w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const r = Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t);
    const g = Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t);
    const b = Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t);
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      px[d] = r; px[d + 1] = g; px[d + 2] = b; px[d + 3] = 255;
    }
  }
  return { width: w, height: h, pixels: px };
}

// Blit a source tile onto the canvas at (ox, oy) with rounded corners and a
// 1px accent hairline border, over-source (source is opaque).
function blit(canvas, tile, ox, oy, radius) {
  const { width: cw, pixels: cp } = canvas;
  const { width: tw, height: th, pixels: tp } = tile;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      // Rounded-corner mask.
      let inside = true;
      const rx = x < radius ? radius - x : x >= tw - radius ? x - (tw - radius - 1) : 0;
      const ry = y < radius ? radius - y : y >= th - radius ? y - (th - radius - 1) : 0;
      if (rx > 0 && ry > 0) inside = Math.hypot(rx, ry) <= radius;
      if (!inside) continue;
      const cx = ox + x, cy = oy + y;
      const d = (cy * cw + cx) * 4;
      const s = (y * tw + x) * 4;
      cp[d] = tp[s]; cp[d + 1] = tp[s + 1]; cp[d + 2] = tp[s + 2]; cp[d + 3] = 255;
    }
  }
  // Thin accent border tracing the rounded rect.
  const border = 2;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const rx = x < radius ? radius - x : x >= tw - radius ? x - (tw - radius - 1) : 0;
      const ry = y < radius ? radius - y : y >= th - radius ? y - (th - radius - 1) : 0;
      const dist = rx > 0 && ry > 0 ? Math.hypot(rx, ry) : Math.max(rx, ry, 0);
      const edge = rx > 0 && ry > 0
        ? Math.abs(dist - radius) <= border
        : x < border || x >= tw - border || y < border || y >= th - border;
      if (!edge || (rx > 0 && ry > 0 && dist > radius)) continue;
      const cx = ox + x, cy = oy + y;
      const d = ((cy) * cw + cx) * 4;
      cp[d] = ACCENT[0]; cp[d + 1] = ACCENT[1]; cp[d + 2] = ACCENT[2]; cp[d + 3] = 255;
    }
  }
}

// ── Generate ──────────────────────────────────────────────────────────────────
export { decodePNG, encodePNG, resize };
const SOURCES = ['screenshot-mobile.png', 'screenshot-detail.png', 'screenshot-calendar.png'];
export const OUT_W = 1920;
export const OUT_H = 1080;

export function generate({ log = true } = {}) {
  const publicDir = path.resolve(__dirname, '..', 'public');
  const canvas = makeCanvas(OUT_W, OUT_H);

  const tileH = 880;
  const gap = 56;
  const tiles = SOURCES.map((name) => {
    const src = decodePNG(fs.readFileSync(path.join(publicDir, name)));
    const tileW = Math.round((tileH * src.width) / src.height);
    return resize(src, tileW, tileH);
  });

  const totalW = tiles.reduce((sum, t) => sum + t.width, 0) + gap * (tiles.length - 1);
  let x = Math.round((OUT_W - totalW) / 2);
  const y = Math.round((OUT_H - tileH) / 2);
  const radius = 44;
  for (const tile of tiles) {
    blit(canvas, tile, x, y, radius);
    x += tile.width + gap;
  }

  const png = encodePNG(OUT_W, OUT_H, Buffer.from(canvas.pixels));
  const outPath = path.join(publicDir, 'screenshot-wide.png');
  fs.writeFileSync(outPath, png);
  if (log) {
    console.log(`wide screenshot written to ${outPath} (${OUT_W}x${OUT_H}, ${(png.length / 1024).toFixed(1)} KB)`);
  }
  return { path: outPath, width: OUT_W, height: OUT_H, bytes: png.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generate();
}
