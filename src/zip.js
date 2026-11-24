'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** Минимальный распаковщик zip/jar (без внешних зависимостей). */
function extractZip(zipPath, dest, filter) {
  const buf = fs.readFileSync(zipPath);
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('Некорректный zip-файл: ' + zipPath);
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  const base = path.resolve(dest);
  fs.mkdirSync(base, { recursive: true });

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Повреждён каталог zip');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    off += 46 + nlen + elen + clen;

    if (name.endsWith('/')) {
      const dir = path.resolve(base, name);
      if (dir.startsWith(base)) fs.mkdirSync(dir, { recursive: true });
      continue;
    }
    if (filter && !filter(name)) continue;
    const target = path.resolve(base, name);
    if (!target.startsWith(base + path.sep)) continue; // защита от zip-slip

    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const data = buf.subarray(start, start + csize);
    let out;
    if (method === 0) out = data;
    else if (method === 8) out = zlib.inflateRawSync(data);
    else throw new Error('Неподдерживаемый метод сжатия zip: ' + method);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out);
  }
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Проверка целостности zip/jar: имена в UTF-8, данные распаковываются, CRC32 совпадает. Возвращает null или текст ошибки. */
function verifyZip(zipPath) {
  let buf;
  try { buf = fs.readFileSync(zipPath); } catch (e) { return 'не читается: ' + e.message; }
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return 'нет каталога zip';
  const dec = new TextDecoder('utf-8', { fatal: true });
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  try {
    for (let n = 0; n < count; n++) {
      if (buf.readUInt32LE(off) !== 0x02014b50) return 'повреждён каталог zip';
      const method = buf.readUInt16LE(off + 10);
      const crc = buf.readUInt32LE(off + 16);
      const csize = buf.readUInt32LE(off + 20);
      const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
      const lho = buf.readUInt32LE(off + 42);
      const name = dec.decode(buf.subarray(off + 46, off + 46 + nlen));
      off += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      const out = method === 0 ? data : zlib.inflateRawSync(data);
      if (crc32(out) !== crc) return 'неверная контрольная сумма: ' + name;
    }
  } catch (e) { return 'повреждён (' + e.message + ')'; }
  return null;
}

module.exports = { extractZip, verifyZip, crc32 };
