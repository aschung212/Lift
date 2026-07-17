#!/usr/bin/env node
/**
 * Generates iOS PWA launch screens (apple-touch-startup-image) from scratch
 * using only Node.js built-ins — no native deps, no image libraries.
 *
 * On a cold launch from the iOS Home Screen, Safari shows a blank screen until
 * the HTML first-paints. iOS only displays a true launch image when a matching
 * <link rel="apple-touch-startup-image" media="..."> tag exists for the device
 * resolution. These PNGs bridge that gap with a branded mark that matches the
 * in-app #splash (Eternal dark background + gold barbell glyph), so the cold
 * start no longer flashes white before the app paints.
 *
 * Output: public/launch/apple-launch-<w>x<h>.png (one per device resolution).
 * The matching <link> tags live in index.html; DEVICES below is the source of
 * truth for which resolutions are covered (kept in sync with the link tags and
 * launchScreens.test.ts).
 *
 * Run with: node scripts/generate-launch-screens.js
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

function encodePNG(width, height, pixels) {
  const rowLen = width * 4;
  const raw    = Buffer.allocUnsafe((rowLen + 1) * height);

  for (let y = 0; y < height; y++) {
    raw[y * (rowLen + 1)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * (rowLen + 1) + 1 + x * 4;
      raw[dst]     = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Palette (Eternal dark — the default theme) ────────────────────────────────
// Matches src/themes/eternal.css [data-theme="eternal"][data-mode="dark"] so the
// launch image flows seamlessly into the #splash and the real app.
const BG  = [12, 12, 12];     // --bg-primary  #0c0c0c
const MARK = [200, 168, 76];  // --accent      #c8a84c

// ── Barbell glyph ─────────────────────────────────────────────────────────────
// Two weight discs joined by a horizontal bar, sized relative to the shorter
// (width) axis so it never stretches on tall portrait canvases. Centered, then
// nudged up slightly to optically balance against the home-indicator gap.
function makeGlyph(w, h) {
  const cx = w / 2;
  const cy = h * 0.46;          // nudge up from dead-center
  const unit = w;               // scale by width so aspect ratio is preserved

  const discR    = unit * 0.095;
  const discOffX = unit * 0.1475;
  const barHalfH = unit * 0.0325;

  const lx = cx - discOffX;
  const rx = cx + discOffX;

  // Bounding box of the mark (+1px slack) so we only supersample near it.
  const minX = Math.max(0, Math.floor(lx - discR - 1));
  const maxX = Math.min(w, Math.ceil(rx + discR + 1));
  const minY = Math.max(0, Math.floor(cy - discR - 1));
  const maxY = Math.min(h, Math.ceil(cy + discR + 1));

  function sample(fx, fy) {
    if (Math.hypot(fx - lx, fy - cy) <= discR) return 1; // left disc
    if (Math.hypot(fx - rx, fy - cy) <= discR) return 1; // right disc
    if (fx >= lx && fx <= rx && Math.abs(fy - cy) <= barHalfH) return 1; // bar
    return 0;
  }

  return { minX, maxX, minY, maxY, sample };
}

function renderLaunch(w, h) {
  const pixels = new Uint8Array(w * h * 4);

  // Flat background fill.
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = BG[0]; pixels[i + 1] = BG[1]; pixels[i + 2] = BG[2]; pixels[i + 3] = 255;
  }

  // Anti-aliased glyph, only within its bounding box (background stays flat).
  const SS = 4; // 4×4 supersampling
  const g = makeGlyph(w, h);
  for (let py = g.minY; py < g.maxY; py++) {
    for (let px = g.minX; px < g.maxX; px++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          acc += g.sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
        }
      }
      if (acc === 0) continue;
      const t = acc / (SS * SS);
      const i = (py * w + px) * 4;
      pixels[i]     = Math.round(MARK[0] * t + BG[0] * (1 - t));
      pixels[i + 1] = Math.round(MARK[1] * t + BG[1] * (1 - t));
      pixels[i + 2] = Math.round(MARK[2] * t + BG[2] * (1 - t));
    }
  }

  return pixels;
}

// ── Device resolutions (portrait, physical pixels) ────────────────────────────
// Each entry covers one or more iPhones that share the same logical viewport
// and device-pixel-ratio. Source of truth for the index.html <link> media
// queries and launchScreens.test.ts.
export const DEVICES = [
  { dw: 320, dh: 568, dpr: 2, note: 'SE 1st gen / 5 / 5s' },
  { dw: 375, dh: 667, dpr: 2, note: 'SE 2/3, 8, 7, 6s' },
  { dw: 414, dh: 736, dpr: 3, note: '8 Plus / 7 Plus / 6s Plus' },
  { dw: 375, dh: 812, dpr: 3, note: 'X / XS / 11 Pro' },
  { dw: 414, dh: 896, dpr: 2, note: 'XR / 11' },
  { dw: 414, dh: 896, dpr: 3, note: 'XS Max / 11 Pro Max' },
  { dw: 390, dh: 844, dpr: 3, note: '12 / 12 Pro / 13 / 13 Pro / 14' },
  { dw: 428, dh: 926, dpr: 3, note: '12 Pro Max / 13 Pro Max / 14 Plus' },
  { dw: 393, dh: 852, dpr: 3, note: '14 Pro / 15 / 15 Pro / 16' },
  { dw: 430, dh: 932, dpr: 3, note: '14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus' },
  { dw: 402, dh: 874, dpr: 3, note: '16 Pro' },
  { dw: 440, dh: 956, dpr: 3, note: '16 Pro Max' },
];

// ── Generate all launch screens ───────────────────────────────────────────────
export function generate({ log = true } = {}) {
  const outDir = path.resolve(__dirname, '..', 'public', 'launch');
  fs.mkdirSync(outDir, { recursive: true });

  let totalBytes = 0;
  const written = [];
  for (const d of DEVICES) {
    const w = d.dw * d.dpr;
    const h = d.dh * d.dpr;
    const name = `apple-launch-${w}x${h}.png`;
    if (log) process.stdout.write(`  generating ${name} (${d.note}) ... `);
    const png = encodePNG(w, h, renderLaunch(w, h));
    fs.writeFileSync(path.join(outDir, name), png);
    totalBytes += png.length;
    written.push({ name, w, h, bytes: png.length });
    if (log) console.log(`done (${(png.length / 1024).toFixed(1)} KB)`);
  }

  if (log) {
    console.log(`\n${DEVICES.length} launch screens written to ${outDir}/ (${(totalBytes / 1024).toFixed(1)} KB total)`);
  }
  return written;
}

// Run when invoked directly (node scripts/generate-launch-screens.js).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generate();
}
