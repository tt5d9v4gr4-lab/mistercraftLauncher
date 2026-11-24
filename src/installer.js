'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { getJson, download, pool } = require('./http');
const { allowed, mavenPath } = require('./rules');
const { extractZip } = require('./zip');
const V = require('./versions');

const RESOURCES_URL = process.env.MC_RESOURCES_URL || 'https://resources.download.minecraft.net';

function libraryJobs(resolved) {
  const jobs = new Map();
  const natives = [];
  const add = (job) => { if (job.url && !jobs.has(job.dest)) jobs.set(job.dest, job); };

  for (const lib of resolved.libraries || []) {
    if (!allowed(lib.rules)) continue;
    const d = lib.downloads;
    if (d) {
      if (d.artifact && d.artifact.path) {
        add({ url: d.artifact.url, dest: path.join(P.libraries, d.artifact.path), sha1: d.artifact.sha1, size: d.artifact.size });
      }
      if (lib.natives && lib.natives.windows) {
        const cls = lib.natives.windows.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
        const a = d.classifiers && d.classifiers[cls];
        if (a) {
          const dest = path.join(P.libraries, a.path);
          add({ url: a.url, dest, sha1: a.sha1, size: a.size });
          natives.push({ file: dest, exclude: (lib.extract && lib.extract.exclude) || ['META-INF/'] });
        }
      }
    } else if (lib.name) {
      const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
      const rel = mavenPath(lib.name);
      add({ url: base + rel, dest: path.join(P.libraries, rel) });
    }
  }
  return { jobs: [...jobs.values()], natives };
}

async function assetJobs(resolved) {
  const ai = resolved.assetIndex;
  if (!ai) return { jobs: [], idx: null, indexId: null };
  const idxPath = path.join(P.assets, 'indexes', ai.id + '.json');
  await download(ai.url, idxPath, { sha1: ai.sha1, size: ai.size });
  const idx = V.readJson(idxPath);
  const jobs = Object.entries(idx.objects || {}).map(([name, o]) => ({
    url: `${RESOURCES_URL}/${o.hash.slice(0, 2)}/${o.hash}`,
    dest: path.join(P.assets, 'objects', o.hash.slice(0, 2), o.hash),
    size: o.size,
    name,
    hash: o.hash,
  }));
  return { jobs, idx, indexId: ai.id };
}

function mapLegacyAssets(idx, indexId, gameDir) {
  if (!idx || (!idx.virtual && !idx.map_to_resources)) return;
  const base = idx.map_to_resources ? path.join(gameDir, 'resources') : path.join(P.assets, 'virtual', indexId);
  for (const [name, o] of Object.entries(idx.objects)) {
    const dest = path.join(base, name);
    if (fs.existsSync(dest)) continue;
    const src = path.join(P.assets, 'objects', o.hash.slice(0, 2), o.hash);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/** Докачивает всё, что нужно уже скачанной version.json (jar, библиотеки, ресурсы, natives). */
async function installResolved(id, onProgress = () => {}, gameDir = P.root) {
  P.ensure();
  const r = V.loadResolved(id);
  const jobs = new Map();
  const add = (j) => { if (j.url && !jobs.has(j.dest)) jobs.set(j.dest, j); };

  const clientJar = path.join(P.versions, r.jarId, r.jarId + '.jar');
  if (r.downloads && r.downloads.client) {
    add({ url: r.downloads.client.url, dest: clientJar, sha1: r.downloads.client.sha1, size: r.downloads.client.size });
  } else if (!fs.existsSync(clientJar)) {
    throw new Error(`Для версии ${id} нет клиентского файла (${r.jarId}.jar)`);
  }

  const lib = libraryJobs(r);
  lib.jobs.forEach(add);

  onProgress(null, 'Проверка ресурсов…');
  const assets = await assetJobs(r);
  assets.jobs.forEach(add);

  const log = r.logging && r.logging.client && r.logging.client.file;
  if (log && log.url) {
    add({ url: log.url, dest: path.join(P.assets, 'log_configs', log.id), sha1: log.sha1, size: log.size });
  }

  const list = [...jobs.values()];
  const total = list.reduce((s, j) => s + (j.size || 0), 0);
  let done = 0;
  let last = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - last < 120) return;
    last = now;
    const pct = total ? Math.max(0, Math.min(99, Math.round((done / total) * 100))) : null;
    onProgress(pct, `Загрузка файлов Minecraft ${id}`);
  };
  emit(true);
  await pool(list, 16, (j) =>
    download(j.url, j.dest, {
      sha1: j.sha1,
      size: j.size,
      onBytes: (n) => { done += n; emit(false); },
    })
  );

  onProgress(99, 'Распаковка библиотек…');
  const nativesDir = path.join(P.versions, id, 'natives');
  const hasNatives = fs.existsSync(nativesDir) && fs.readdirSync(nativesDir).length > 0;
  if (!hasNatives) {
    for (const n of lib.natives) {
      extractZip(n.file, nativesDir, (name) => !n.exclude.some((e) => name.startsWith(e)));
    }
  }
  fs.mkdirSync(nativesDir, { recursive: true });

  mapLegacyAssets(assets.idx, assets.indexId, gameDir);
  fs.writeFileSync(path.join(P.versions, id, '.installed'), new Date().toISOString());
  onProgress(100, 'Файлы установлены');
}

/** Установка ванильной версии: скачивает version.json из манифеста и все файлы. */
async function installVanilla(id, onProgress = () => {}, gameDir = P.root) {
  P.ensure();
  if (!V.validId(id)) throw new Error('Недопустимая версия');
  let entry = null;
  try {
    const manifest = await V.getManifest();
    entry = manifest.versions.find((v) => v.id === id) || null;
  } catch (e) {
    if (!fs.existsSync(V.versionJsonPath(id))) throw e;
  }
  if (entry) {
    onProgress(null, `Получение описания версии ${id}…`);
    await download(entry.url, V.versionJsonPath(id), { sha1: entry.sha1 });
  } else if (!fs.existsSync(V.versionJsonPath(id))) {
    throw new Error(`Версия ${id} не найдена в официальном списке`);
  }
  await installResolved(id, onProgress, gameDir);
}

module.exports = { installVanilla, installResolved, libraryJobs, assetJobs };
