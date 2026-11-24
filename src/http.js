'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const UA = 'MisterCraftLauncher/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, opts = {}, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
      if (r.status >= 500 && i < tries - 1) {
        await sleep(500 * (i + 1));
        continue;
      }
      return r;
    } catch (e) {
      err = e;
      await sleep(500 * (i + 1));
    }
  }
  throw err;
}

async function getJson(url, opts) {
  const r = await fetchRetry(url, opts);
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}: ${url}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

function sha1File(p, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(p)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/**
 * Скачивает файл (с повторами, проверкой sha1, пропуском уже скачанных).
 * onBytes(n) вызывается с количеством скачанных (или найденных в кэше) байт.
 */
async function download(url, dest, { sha1, sha256, size, onBytes, signal } = {}) {
  if (fs.existsSync(dest)) {
    const st = fs.statSync(dest);
    if (st.size > 0) {
      let ok;
      if (size != null) ok = st.size === size;
      else if (sha256) ok = (await sha1File(dest, 'sha256')) === sha256.toLowerCase();
      else if (sha1) ok = (await sha1File(dest)) === sha1;
      else ok = true;
      if (ok) {
        if (onBytes) onBytes(st.size);
        return 'cached';
      }
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    let counted = 0;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal });
      if (!r.ok) {
        const e = new Error(`HTTP ${r.status}: ${url}`);
        e.status = r.status;
        throw e;
      }
      const body = Readable.fromWeb(r.body);
      body.on('data', (c) => {
        counted += c.length;
        if (onBytes) onBytes(c.length);
      });
      await pipeline(body, fs.createWriteStream(part));
      if (sha1 && (await sha1File(part)) !== sha1) throw new Error(`Неверная контрольная сумма: ${url}`);
      if (sha256 && (await sha1File(part, 'sha256')) !== sha256.toLowerCase()) throw new Error(`Неверная контрольная сумма (файл повреждён при загрузке): ${url}`);
      fs.renameSync(part, dest);
      return 'downloaded';
    } catch (e) {
      lastErr = e;
      if (onBytes && counted) onBytes(-counted);
      try { fs.unlinkSync(part); } catch {}
      if (signal && signal.aborted) { lastErr = new Error('Загрузка отменена'); break; }
      if (e.status === 404) break;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function pool(items, n, fn) {
  let i = 0;
  let err = null;
  const worker = async () => {
    while (i < items.length && !err) {
      const it = items[i++];
      try { await fn(it); } catch (e) { err = e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (err) throw err;
}

module.exports = { getJson, fetchRetry, download, sha1File, pool, sleep, UA };
