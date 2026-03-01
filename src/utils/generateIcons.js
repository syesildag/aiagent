/**
 * Generates minimal 192×192 and 512×512 PNG icons for the PWA manifest.
 * Uses only Node.js built-ins (zlib for DEFLATE, fs for output).
 * Theme colour: #1976d2 (MUI primary blue) with a centred white robot glyph.
 */
'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC-32 ──────────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk helper ─────────────────────────────────────────────────────────
function chunk(type, data) {
  const tb  = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

// ── Pixel painter ────────────────────────────────────────────────────────────
// Returns an RGBA Uint8Array for a square canvas of `size` pixels.
function paint(size) {
  const px = new Uint8Array(size * size * 4);

  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
  };

  const rect = (x, y, w, h, r, g, b) => {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        set(x + dx, y + dy, r, g, b);
  };

  const circle = (cx, cy, radius, r, g, b) => {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++)
        if (dx*dx + dy*dy <= radius*radius)
          set(cx + dx, cy + dy, r, g, b);
  };

  const s = size;
  const u = Math.round;          // shorthand for rounding
  const BG = [25, 118, 210];     // #1976d2 – MUI primary blue
  const WH = [255, 255, 255];    // white

  // Background fill
  rect(0, 0, s, s, ...BG);

  // ── Simple robot icon (scaled to icon size) ──────────────────────────────
  // All coordinates are expressed as fractions of `s` then rounded.
  const p = f => u(f * s);   // fraction → pixel

  // Rounded-rect background square (slightly lighter blue)
  const pad = p(0.08);
  rect(pad, pad, s - pad*2, s - pad*2, 41, 128, 218);

  // Head (white rounded rect)
  const hx = p(0.25), hy = p(0.18), hw = p(0.50), hh = p(0.30);
  rect(hx, hy, hw, hh, ...WH);

  // Eyes
  const ey = hy + p(0.08);
  const er = Math.max(2, p(0.055));
  circle(hx + p(0.13), ey, er, ...BG);
  circle(hx + hw - p(0.13), ey, er, ...BG);

  // Antenna
  rect(u(s/2) - Math.max(1, p(0.025)), p(0.06), Math.max(2, p(0.05)), p(0.12), ...WH);
  circle(u(s/2), p(0.06), Math.max(2, p(0.04)), ...WH);

  // Body
  const bx = p(0.20), by = hy + hh + p(0.04), bw = p(0.60), bh = p(0.30);
  rect(bx, by, bw, bh, ...WH);

  // Arms
  const ax = p(0.05), aw = p(0.13), ah = p(0.22), ay = by + p(0.04);
  rect(ax, ay, aw, ah, ...WH);
  rect(s - ax - aw, ay, aw, ah, ...WH);

  // Legs
  const lw = p(0.17), lh = p(0.14), ly = by + bh + p(0.03);
  rect(bx + p(0.05), ly, lw, lh, ...WH);
  rect(bx + bw - p(0.05) - lw, ly, lw, lh, ...WH);

  return px;
}

// ── PNG encoder ──────────────────────────────────────────────────────────────
function makePNG(size) {
  const px = paint(size);

  // IHDR: width, height, 8-bit, RGBA (color type 6)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  // Raw scanlines: filter byte 0 + 4 bytes per pixel
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = y * (1 + size * 4) + 1 + x * 4;
      raw[di]   = px[si];   // R
      raw[di+1] = px[si+1]; // G
      raw[di+2] = px[si+2]; // B
      raw[di+3] = px[si+3]; // A
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG sig
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Write files ───────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, '../frontend/pwa/icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, makePNG(size));
  console.log(`✔ Generated ${file}`);
}
