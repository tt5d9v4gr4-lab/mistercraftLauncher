'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { UA } = require('./http');

const dir = () => { fs.mkdirSync(P.skins, { recursive: true }); return P.skins; };
const indexFile = () => path.join(dir(), 'index.json');

function safeName(n) {
  n = String(n || '').trim();
  if (!/^[\p{L}\p{N} _\-]{1,32}$/u.test(n)) {
    throw new Error('Название: до 32 символов — буквы, цифры, пробел, _ и -');
  }
  return n;
}

function validate(buf) {
  if (buf.length > 1048576) throw new Error('Файл слишком большой.');
  if (buf.length < 24 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a' || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Это не PNG-файл.');
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== 64 || (h !== 64 && h !== 32)) {
    throw new Error(`Скин должен быть PNG размером 64×64 (или 64×32), а у файла ${w}×${h}.`);
  }
}

function readIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return {}; }
}
function writeIndex(i) { fs.writeFileSync(indexFile(), JSON.stringify(i, null, 2)); }
const fileOf = (name) => path.join(dir(), safeName(name) + '.png');
const goodVariant = (v) => (v === 'slim' ? 'slim' : 'classic');

function list() {
  const idx = readIndex();
  return fs.readdirSync(dir())
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => {
      const name = f.slice(0, -4);
      return {
        name,
        variant: goodVariant(idx[name]),
        dataUrl: 'data:image/png;base64,' + fs.readFileSync(path.join(dir(), f)).toString('base64'),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueName(base) {
  let n = base;
  let i = 2;
  while (fs.existsSync(path.join(dir(), n + '.png'))) n = `${base.slice(0, 28)} ${i++}`;
  return n;
}

/** replace=true — перезаписать скин с таким именем; иначе имя должно быть свободно. */
function save(name, buf, variant, { replace = false, unique = false } = {}) {
  validate(buf);
  name = safeName(name);
  if (unique) name = uniqueName(name);
  else if (!replace && fs.existsSync(fileOf(name))) throw new Error(`Скин «${name}» уже существует.`);
  fs.writeFileSync(fileOf(name), buf);
  const idx = readIndex();
  idx[name] = goodVariant(variant);
  writeIndex(idx);
  return name;
}

function setVariant(name, variant) {
  safeName(name);
  const idx = readIndex();
  idx[name] = goodVariant(variant);
  writeIndex(idx);
}

function remove(name) {
  const f = fileOf(name);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  const idx = readIndex();
  delete idx[name];
  writeIndex(idx);
}

/** Загружает скин на аккаунт Minecraft (только для Microsoft-аккаунтов). */
async function upload(name, mcToken) {
  const f = fileOf(name);
  if (!fs.existsSync(f)) throw new Error('Скин не найден.');
  const buf = fs.readFileSync(f);
  validate(buf);
  const fd = new FormData();
  fd.append('variant', goodVariant(readIndex()[name]));
  fd.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + mcToken, 'User-Agent': UA },
    body: fd,
  });
  if (!r.ok) {
    let m = '';
    try { m = (await r.json()).errorMessage || ''; } catch {}
    throw new Error(`Mojang не принял скин (${r.status})${m ? ': ' + m : ''}`);
  }
}

module.exports = { list, save, remove, setVariant, upload, validate, safeName };
