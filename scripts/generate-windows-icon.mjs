#!/usr/bin/env node
import fs from "node:fs";

const output = process.argv[2];
if (!output) throw new Error("usage: generate-windows-icon.mjs OUTPUT.ico");

// A small self-contained ICO writer keeps release builds independent of
// ImageMagick and gives Windows shortcuts the same Rowset mark as the web UI.
const size = 32;
const dibSize = 40;
const pixels = Buffer.alloc(size * size * 4);
const mask = Buffer.alloc(size * size / 8);
const setPixel = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = ((size - 1 - y) * size + x) * 4;
  pixels[i] = b; pixels[i + 1] = g; pixels[i + 2] = r; pixels[i + 3] = a;
};
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
  const inside = edge >= 2 && (x < 3 || y < 3 || x >= size - 3 || y >= size - 3
    ? Math.hypot(Math.max(0, 3 - x), Math.max(0, 3 - y)) <= 3
    : true);
  if (!inside) continue;
  const t = (x + y) / (size * 2);
  setPixel(x, y, Math.round(202 - 62 * t), Math.round(117 - 59 * t), Math.round(80 - 46 * t));
}
const bar = (x, y, w, h, color) => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(xx, yy, ...color);
};
bar(7, 9, 18, 3, [255, 255, 255, 210]);
bar(7, 14, 11, 4, [255, 255, 255, 255]);
bar(20, 14, 5, 4, [242, 221, 208, 255]);
bar(7, 20, 18, 3, [255, 255, 255, 210]);

const header = Buffer.alloc(6 + 16 + dibSize);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt8(size, 6); header.writeUInt8(size, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(dibSize + pixels.length + mask.length, 14); header.writeUInt32LE(header.length, 18);
const dib = header.subarray(22);
dib.writeUInt32LE(dibSize, 0); dib.writeInt32LE(size, 4); dib.writeInt32LE(size * 2, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(0, 16); dib.writeUInt32LE(pixels.length + mask.length, 20); dib.writeInt32LE(0, 24); dib.writeInt32LE(0, 28); dib.writeUInt32LE(0, 32); dib.writeUInt32LE(0, 36);
fs.writeFileSync(output, Buffer.concat([header, pixels, mask]));
