#!/usr/bin/env node
/**
 * Generates PWA PNG icons from scratch using only Node.js built-ins.
 * Renders a barbell icon on a dark background with supersampled anti-aliasing.
 *
 * Run with: node scripts/generate-icons.js
 */

'use strict';
const zlib = require('node:zlib');
const fs   = require('node:fs');
const path = require('node:path');

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
    pngChunk('IDAT', zlib.deflateSync(raw)),
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

// ── Output ───────────────────────────────────────────────────────────────────
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
