#!/usr/bin/env node
/**
 * Generates the wide (landscape) PWA manifest screenshot from scratch using only
 * Node.js built-ins — no native deps, no image libraries.
 *
 * Chromium's richer install dialog (desktop Chrome/Edge and some Android surfaces)
 * only renders the enhanced screenshot-carousel UI when a `form_factor: 'wide'`
 * screenshot is present in the manifest; without one the install prompt falls back
 * to a minimal one-line prompt (#1064). Our three shipped screenshots are all
 * `narrow` (phone portrait), so this composites them side-by-side onto a branded
 * dark canvas to produce a single wide preview.
 *
 * The source screenshots (public/screenshot-{mobile,detail,calendar}.png) are the
 * single source of truth — re-run this after replacing any of them so the wide
 * preview stays in sync.
 *
 * Output: public/screenshot-wide.png (1920×1080).
 * Run with: node scripts/generate-wide-screenshot.js
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');

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
    const dstRow = y * (rowLen + 1) + 1;
    const srcRow = y * rowLen;
    for (let x = 0; x < rowLen; x++) raw[dstRow + x] = pixels[srcRow + x];
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

// ── PNG decoder (8-bit, non-interlaced; color types 0/2/4/6) ──────────────────
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); pos += 4;
    const type = buf.toString('ascii', pos, pos + 4); pos += 4;
    const data = buf.subarray(pos, pos + len); pos += len;
    pos += 4; // skip CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`unsupported color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const rawB = raw[rp++];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let val;
      switch (ft) {
        case 0: val = rawB; break;
        case 1: val = rawB + a; break;
        case 2: val = rawB + b; break;
        case 3: val = rawB + ((a + b) >> 1); break;
        case 4: val = rawB + paeth(a, b, c); break;
        default: throw new Error(`bad filter ${ft}`);
      }
      cur[x] = val & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      let r, g, bl, al;
      if (colorType === 2) { r = cur[si]; g = cur[si + 1]; bl = cur[si + 2]; al = 255; }
      else if (colorType === 6) { r = cur[si]; g = cur[si + 1]; bl = cur[si + 2]; al = cur[si + 3]; }
      else if (colorType === 0) { r = g = bl = cur[si]; al = 255; }
      else { r = g = bl = cur[si]; al = cur[si + 1]; } // colorType 4 (gray + alpha)
      out[di] = r; out[di + 1] = g; out[di + 2] = bl; out[di + 3] = al;
    }
    prev.set(cur); // this row becomes "prev" for the next scanline's filter
  }
  return { width, height, data: out };
}

// ── Box-average downscale (proper anti-aliasing for ~2× reductions) ───────────
function resize(img, dw, dh) {
  const { width: sw, height: sh, data } = img;
  const out = new Uint8Array(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor((dy * sh) / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor((dx * sw) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const si = (sy * sw + sx) * 4;
          r += data[si]; g += data[si + 1]; b += data[si + 2]; a += data[si + 3]; n++;
        }
      }
      const di = (dy * dw + dx) * 4;
      out[di] = Math.round(r / n); out[di + 1] = Math.round(g / n);
      out[di + 2] = Math.round(b / n); out[di + 3] = Math.round(a / n);
    }
  }
  return { width: dw, height: dh, data: out };
}

// ── Composition constants ─────────────────────────────────────────────────────
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const BG_TOP = [16, 16, 16];   // subtle vertical gradient, Eternal-dark family
const BG_BOTTOM = [9, 9, 9];
const ACCENT = [200, 168, 76]; // --accent gold (#c8a84c)

const PHONE_H = 840;
const PHONE_GAP = 72;
const CORNER_R = 40;
const BORDER = 3;

// Signed distance to a rounded rectangle centred at (cx, cy) with half-extents
// (hw, hh) and corner radius r. Negative inside, positive outside.
function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function blend(px, i, r, g, b, cover) {
  if (cover <= 0) return;
  const inv = 1 - cover;
  px[i] = Math.round(r * cover + px[i] * inv);
  px[i + 1] = Math.round(g * cover + px[i + 1] * inv);
  px[i + 2] = Math.round(b * cover + px[i + 2] * inv);
}

function generate({ log = true } = {}) {
  const sources = ['screenshot-mobile.png', 'screenshot-detail.png', 'screenshot-calendar.png'];
  const shots = sources.map((name) => decodePNG(fs.readFileSync(path.join(PUBLIC, name))));

  // Scale each phone to a shared display height, preserving its own aspect ratio.
  const scaled = shots.map((img) => {
    const w = Math.round((PHONE_H * img.width) / img.height);
    return resize(img, w, PHONE_H);
  });

  const totalW = scaled.reduce((s, img) => s + img.width, 0) + PHONE_GAP * (scaled.length - 1);
  let cursorX = Math.round((CANVAS_W - totalW) / 2);
  const phoneY = Math.round((CANVAS_H - PHONE_H) / 2) + 24; // nudge down for a top brand gap

  // Canvas + vertical gradient background.
  const px = new Uint8Array(CANVAS_W * CANVAS_H * 4);
  for (let y = 0; y < CANVAS_H; y++) {
    const t = y / (CANVAS_H - 1);
    const r = Math.round(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t);
    const g = Math.round(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t);
    const b = Math.round(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t);
    for (let x = 0; x < CANVAS_W; x++) {
      const i = (y * CANVAS_W + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }

  // Brand mark: a small gold barbell centred above the phone row.
  drawBarbell(px, CANVAS_W / 2, phoneY - 66, 30);

  // Composite each phone: gold ring border, then rounded-corner screenshot.
  for (const img of scaled) {
    const x0 = cursorX;
    const y0 = phoneY;
    const cx = x0 + img.width / 2;
    const cy = y0 + img.height / 2;
    const hw = img.width / 2;
    const hh = img.height / 2;
    const pad = BORDER + 2;
    const minX = Math.max(0, Math.floor(x0 - pad));
    const maxX = Math.min(CANVAS_W, Math.ceil(x0 + img.width + pad));
    const minY = Math.max(0, Math.floor(y0 - pad));
    const maxY = Math.min(CANVAS_H, Math.ceil(y0 + img.height + pad));

    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = (y * CANVAS_W + x) * 4;
        const sdfImg = roundedRectSDF(x + 0.5, y + 0.5, cx, cy, hw, hh, CORNER_R);
        const sdfOuter = roundedRectSDF(x + 0.5, y + 0.5, cx, cy, hw + BORDER, hh + BORDER, CORNER_R + BORDER);
        const coverImg = Math.min(Math.max(0.5 - sdfImg, 0), 1);
        const coverOuter = Math.min(Math.max(0.5 - sdfOuter, 0), 1);
        // Border ring first (behind the image edge AA).
        const borderCover = Math.max(0, coverOuter - coverImg);
        blend(px, i, ACCENT[0], ACCENT[1], ACCENT[2], borderCover);
        // Then the screenshot pixel, masked to the rounded rect.
        if (coverImg > 0) {
          const sx = Math.min(img.width - 1, Math.max(0, x - x0));
          const sy = Math.min(img.height - 1, Math.max(0, y - y0));
          const si = (sy * img.width + sx) * 4;
          const a = (img.data[si + 3] / 255) * coverImg;
          blend(px, i, img.data[si], img.data[si + 1], img.data[si + 2], a);
        }
      }
    }
    cursorX += img.width + PHONE_GAP;
  }

  const out = encodePNG(CANVAS_W, CANVAS_H, px);
  const dest = path.join(PUBLIC, 'screenshot-wide.png');
  fs.writeFileSync(dest, out);
  if (log) {
    console.log(`wide screenshot written to ${dest} (${CANVAS_W}×${CANVAS_H}, ${(out.length / 1024).toFixed(1)} KB)`);
  }
  return { width: CANVAS_W, height: CANVAS_H, bytes: out.length, path: dest };
}

// Small gold barbell glyph (two discs + bar), anti-aliased via 4× supersampling.
function drawBarbell(px, cx, cy, unit) {
  const discR = unit * 0.9;
  const discOffX = unit * 1.35;
  const barHalfH = unit * 0.3;
  const lx = cx - discOffX;
  const rx = cx + discOffX;
  const minX = Math.max(0, Math.floor(lx - discR - 1));
  const maxX = Math.min(CANVAS_W, Math.ceil(rx + discR + 1));
  const minY = Math.max(0, Math.floor(cy - discR - 1));
  const maxY = Math.min(CANVAS_H, Math.ceil(cy + discR + 1));
  const SS = 4;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          if (Math.hypot(fx - lx, fy - cy) <= discR || Math.hypot(fx - rx, fy - cy) <= discR
            || (fx >= lx && fx <= rx && Math.abs(fy - cy) <= barHalfH)) acc++;
        }
      }
      if (acc === 0) continue;
      blend(px, (y * CANVAS_W + x) * 4, ACCENT[0], ACCENT[1], ACCENT[2], acc / (SS * SS));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generate();
}

export { generate, decodePNG, encodePNG, resize };
