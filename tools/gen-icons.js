#!/usr/bin/env node
/**
 * gen-icons.js — procedurally generate placeholder toolbar icons.
 *
 * These are PLACEHOLDERS. The real brand icon (128px), marquee (1400x560) and
 * screenshots (1280x800) are produced by design before store submission — see the
 * brief's print-at-end checklist. This script only exists so the unpacked extension
 * loads with valid PNGs during development.
 *
 * Zero dependencies: writes real PNGs using Node's built-in zlib. Draws a rounded
 * teal tile with a white download arrow over a small "stack" to imply bulk.
 *
 *   node tools/gen-icons.js
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'icons');
const SIZES = [16, 32, 48, 128];

// Brand-ish palette (placeholder). Kept in sync with shared/tokens.css --bid-accent.
const BG_TOP = [13, 148, 136];    // teal-600
const BG_BOT = [15, 118, 110];    // teal-700
const FG = [255, 255, 255];

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Signed distance to a rounded rectangle centered in an SxS box, in pixel units.
function roundedRectSDF(x, y, S, inset, radius) {
  const cx = S / 2, cy = S / 2;
  const halfW = S / 2 - inset, halfH = S / 2 - inset;
  const qx = Math.abs(x - cx) - (halfW - radius);
  const qy = Math.abs(y - cy) - (halfH - radius);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

function drawIcon(S) {
  const buf = Buffer.alloc(S * S * 4); // RGBA
  const inset = Math.max(1, Math.round(S * 0.06));
  const radius = Math.round(S * 0.22);

  // Arrow geometry (download arrow: shaft + head), plus a baseline "tray".
  const cx = S / 2;
  const shaftTop = S * 0.24;
  const shaftBot = S * 0.56;
  const shaftHalf = Math.max(1, S * 0.055);
  const headTop = S * 0.48;
  const headBot = S * 0.70;
  const headHalf = S * 0.16;
  const trayY = S * 0.80;
  const trayHalf = S * 0.24;
  const trayThick = Math.max(1, S * 0.06);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // Background rounded tile with vertical gradient; anti-aliased edge via SDF.
      const d = roundedRectSDF(x + 0.5, y + 0.5, S, inset, radius);
      const tileA = Math.max(0, Math.min(1, 0.5 - d)); // ~1px AA band
      const t = y / (S - 1);
      let [r, g, b] = lerp(BG_TOP, BG_BOT, t);
      let a = tileA;

      // Foreground glyph coverage (union of shaft, head triangle, tray).
      let fg = 0;
      // Shaft (rectangle)
      if (y >= shaftTop && y <= shaftBot && Math.abs(x - cx) <= shaftHalf) fg = 1;
      // Head (downward triangle): width shrinks to 0 from headTop..headBot
      if (y >= headTop && y <= headBot) {
        const p = (y - headTop) / (headBot - headTop);
        const w = headHalf * (1 - p);
        if (Math.abs(x - cx) <= w) fg = 1;
      }
      // Tray (open box bottom) — a horizontal bar with two short uprights
      if (y >= trayY && y <= trayY + trayThick && Math.abs(x - cx) <= trayHalf) fg = 1;
      if (y >= trayY - trayThick * 2 && y <= trayY + trayThick &&
          Math.abs(Math.abs(x - cx) - trayHalf) <= trayThick / 2) fg = 1;

      if (fg > 0 && tileA > 0.5) {
        r = FG[0]; g = FG[1]; b = FG[2]; a = 1;
      }

      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

// --- Minimal PNG encoder (truecolor+alpha, filter type 0) --------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(rgba, S) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // Add filter byte (0) per scanline
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const S of SIZES) {
  const png = encodePNG(drawIcon(S), S);
  const file = path.join(OUT_DIR, `icon-${S}.png`);
  fs.writeFileSync(file, png);
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), file)} (${png.length} bytes)`);
}
console.log('Done. Placeholder icons generated.');
