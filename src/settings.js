'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');

const DEFAULTS = {
  ramMb: 4096,
  javaPath: 'auto',
  msClientId: process.env.MISTERCRAFT_MS_CLIENT_ID || '',
  hideOnLaunch: false,
  selected: { mc: null, loader: 'vanilla' },
  accounts: [],
  activeAccount: null,
};
const PUBLIC_KEYS = ['ramMb', 'javaPath', 'msClientId', 'hideOnLaunch', 'selected'];

let cache = null;
let crypt = {
  enc: (s) => 'raw:' + Buffer.from(s, 'utf8').toString('base64'),
  dec: (s) => Buffer.from(s.replace(/^raw:/, ''), 'base64').toString('utf8'),
};

function setCrypto(c) { crypt = c; }

function load() {
  if (cache) return cache;
  let d = {};
  try { d = JSON.parse(fs.readFileSync(P.settings, 'utf8')); } catch {}
  cache = { ...DEFAULTS, ...d, selected: { ...DEFAULTS.selected, ...(d.selected || {}) } };
  if (!Array.isArray(cache.accounts)) cache.accounts = [];
  return cache;
}

function save() {
  P.ensure();
  const tmp = P.settings + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, P.settings);
}

function getPublic() {
  const s = load();
  const o = {};
  for (const k of PUBLIC_KEYS) o[k] = s[k];
  return o;
}

function update(patch) {
  const s = load();
  for (const k of PUBLIC_KEYS) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'ramMb') v = Math.max(1024, Math.min(65536, Math.round(Number(v) || 4096)));
    if (k === 'javaPath') v = typeof v === 'string' && v ? v : 'auto';
    if (k === 'msClientId') v = String(v || '').trim();
    if (k === 'hideOnLaunch') v = !!v;
    if (k === 'selected') v = { mc: v && typeof v.mc === 'string' ? v.mc : null, loader: ['vanilla', 'fabric', 'forge'].includes(v && v.loader) ? v.loader : 'vanilla' };
    s[k] = v;
  }
  save();
  return getPublic();
}

const SEALED = ['refreshToken', 'mcToken'];

function seal(acc) {
  const o = { ...acc };
  for (const k of SEALED) if (o[k]) o[k] = crypt.enc(o[k]);
  return o;
}

function unseal(acc) {
  const o = { ...acc };
  for (const k of SEALED) {
    if (o[k]) {
      try { o[k] = crypt.dec(o[k]); } catch { o[k] = null; }
    }
  }
  return o;
}

function listAccounts() {
  const s = load();
  return {
    active: s.activeAccount,
    accounts: s.accounts.map((a) => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid })),
  };
}

function saveAccount(acc, makeActive = true) {
  const s = load();
  const i = s.accounts.findIndex((a) => a.id === acc.id);
  const sealed = seal(acc);
  if (i >= 0) s.accounts[i] = sealed; else s.accounts.push(sealed);
  if (makeActive) s.activeAccount = acc.id;
  save();
}

function getAccount(id) {
  const s = load();
  const a = s.accounts.find((x) => x.id === (id || s.activeAccount));
  return a ? unseal(a) : null;
}

function removeAccount(id) {
  const s = load();
  s.accounts = s.accounts.filter((a) => a.id !== id);
  if (s.activeAccount === id) s.activeAccount = s.accounts.length ? s.accounts[0].id : null;
  save();
}

function setActive(id) {
  const s = load();
  if (s.accounts.some((a) => a.id === id)) { s.activeAccount = id; save(); }
}

module.exports = { setCrypto, getPublic, update, listAccounts, saveAccount, getAccount, removeAccount, setActive, _reset: () => { cache = null; } };
