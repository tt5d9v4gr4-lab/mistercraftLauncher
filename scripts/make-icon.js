'use strict';
// Генерирует иконку лаунчера (build/icon.png, build/icon.ico, renderer/assets/icon.png) без внешних зависимостей.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 16, SCALE = 16, SIZE = N * SCALE;
const BLACK = [10, 10, 10, 255], Y = [255, 204, 0, 255], D = [184, 138, 0, 255], T = [0, 0, 0, 0];

const grid = Array.from({ length: N }, () => Array.from({ length: N }, () => BLACK));
const set = (x, y, c) => { if (x >= 0 && x < N && y >= 0 && y < N) grid[y][x] = c; };

for (let i = 0; i < N; i++) { set(i, 0, Y); set(i, N - 1, Y); set(0, i, Y); set(N - 1, i, Y); }
for (let i = 1; i < N - 1; i++) { set(i, 1, D); set(i, N - 2, D); set(1, i, D); set(N - 2, i, D); }
for (const [x, y] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) set(x, y, T);

const M = [
  'XX......XX',
  'XXX....XXX',
  'XXXX..XXXX',
  'XX.XXXX.XX',
  'XX..XX..XX',
  'XX......XX',
  'XX......XX',
  'XX......XX',
];
M.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === 'X') set(3 + rx, 4 + ry, Y); }));
for (let x = 3; x < 13; x++) { set(x, 12, D); }

const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const c = grid[(y / SCALE) | 0][(x / SCALE) | 0];
    const o = (y * SIZE + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3];
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ICO с вложенным PNG 256x256
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'renderer', 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png);
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([ico, png]));
fs.writeFileSync(path.join(root, 'renderer', 'assets', 'icon.png'), png);
console.log('Иконки созданы.');
