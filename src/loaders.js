'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const P = require('./paths');
const V = require('./versions');
const { getJson, download } = require('./http');
const { installResolved } = require('./installer');
const { verifyZip } = require('./zip');

const FABRIC = process.env.FABRIC_META_URL || 'https://meta.fabricmc.net/v2';
const FORGE_PROMOS = process.env.FORGE_PROMOS_URL || 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = process.env.FORGE_MAVEN_URL || 'https://maven.minecraftforge.net/net/minecraftforge/forge/';

let promosCache = null;

async function forgePromos() {
  if (promosCache) return promosCache;
  const j = await getJson(FORGE_PROMOS);
  promosCache = j.promos || {};
  return promosCache;
}

async function forgeInfo(mc) {
  const p = await forgePromos();
  const rec = p[`${mc}-recommended`] || null;
  const lat = p[`${mc}-latest`] || null;
  if (!rec && !lat) return null;
  return { recommended: rec, latest: lat, pick: rec || lat };
}

async function fabricList(mc) {
  try {
    const l = await getJson(`${FABRIC}/versions/loader/${encodeURIComponent(mc)}`);
    return Array.isArray(l) ? l : [];
  } catch (e) {
    if (e.status === 400 || e.status === 404) return [];
    throw e;
  }
}

/** Что поддерживается для версии MC. null = не удалось проверить (нет сети). */
async function support(mc) {
  const out = { fabric: null, forge: null };
  try { out.fabric = (await fabricList(mc)).length > 0; } catch {}
  try { out.forge = !!(await forgeInfo(mc)); } catch {}
  return out;
}

async function installFabric(mc, onProgress = () => {}) {
  onProgress(null, `Подбор Fabric для ${mc}…`);
  const list = await fabricList(mc);
  if (!list.length) throw new Error(`Fabric не поддерживает Minecraft ${mc}`);
  const pick = list.find((x) => x.loader && x.loader.stable) || list[0];
  const profile = await getJson(
    `${FABRIC}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(pick.loader.version)}/profile/json`
  );
  const id = profile.id;
  if (!V.validId(id)) throw new Error('Fabric вернул некорректный идентификатор версии');
  fs.mkdirSync(path.join(P.versions, id), { recursive: true });
  fs.writeFileSync(V.versionJsonPath(id), JSON.stringify(profile, null, 2));
  await installResolved(id, onProgress);
  return id;
}

async function ensureFabric(mc, onProgress) {
  const existing = V.listInstalled().filter((v) => v.loader === 'fabric' && v.parent === mc);
  if (existing.length) {
    const id = existing.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0].id;
    await installResolved(id, onProgress);
    return id;
  }
  return installFabric(mc, onProgress);
}

function runInstaller(javaPath, jar, onProgress) {
  return new Promise((resolve, reject) => {
    const tail = [];
    const child = spawn(javaPath, ['-jar', jar, '--installClient', P.root], { cwd: P.tmp, windowsHide: true });
    const onData = (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        tail.push(t);
        if (tail.length > 40) tail.shift();
        onProgress(null, 'Установка Forge: ' + t.slice(0, 80));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Установщик Forge завершился с ошибкой:\n' + tail.slice(-8).join('\n')));
    });
  });
}

async function installForge(mc, javaPath, onProgress = () => {}) {
  const info = await forgeInfo(mc);
  if (!info) throw new Error(`Forge не поддерживает Minecraft ${mc}`);
  const fv = info.pick;
  P.ensure();
  const jar = path.join(P.tmp, `forge-${mc}-${fv}-installer.jar`);

  let ok = false;
  let lastErr;
  for (const c of [`${mc}-${fv}`, `${mc}-${fv}-${mc}`]) {
    try {
      onProgress(null, `Загрузка установщика Forge ${fv}…`);
      await download(`${FORGE_MAVEN}${c}/forge-${c}-installer.jar`, jar);
      ok = true;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!ok) throw lastErr || new Error('Не удалось скачать установщик Forge');

  const profiles = path.join(P.root, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {}, version: 3 }));

  const before = new Set(fs.readdirSync(P.versions));
  await runInstaller(javaPath, jar, onProgress);
  try { fs.unlinkSync(jar); } catch {}

  const after = fs.readdirSync(P.versions);
  const id =
    after.find((x) => !before.has(x) && /forge/i.test(x)) ||
    after.find((x) => /forge/i.test(x) && x.includes(fv));
  if (!id) throw new Error('Forge установлен, но его версия не найдена в папке versions');
  await installResolved(id, onProgress);
  return id;
}

/** Находит повреждённые/отсутствующие jar из classpath версии (кэш проверок по размеру и времени). */
function scanBad(id) {
  const { buildClasspath } = require('./launch');
  const cacheFile = path.join(P.root, 'jar-check.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const bad = [];
  for (const f of buildClasspath(V.loadResolved(id))) {
    if (!fs.existsSync(f)) { bad.push({ file: f, why: 'отсутствует' }); continue; }
    const st = fs.statSync(f);
    const key = `${st.size}:${Math.round(st.mtimeMs)}`;
    if (cache[f] === key) continue;
    const err = verifyZip(f);
    if (err) bad.push({ file: f, why: err }); else cache[f] = key;
  }
  try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch {}
  return bad;
}

/** Если файлы Forge/Minecraft повреждены (ClassFormatError, MALFORMED) — удаляет их и переустанавливает. */
async function repairForge(mc, id, javaPath, onProgress) {
  let bad = scanBad(id);
  if (!bad.length) return id;
  onProgress(null, `Найдены повреждённые файлы (${bad.length}), переустановка…`);
  for (const b of bad) { try { fs.unlinkSync(b.file); } catch {} }
  await installResolved(mc, onProgress); // перекачает ваниль/библиотеки с проверкой sha1
  const nid = await installForge(mc, javaPath, onProgress);
  bad = scanBad(nid);
  if (bad.length) throw new Error('Файлы игры остаются повреждёнными (проверьте диск/антивирус):\n' + bad.map((b) => `${path.basename(b.file)} — ${b.why}`).join('\n'));
  return nid;
}

async function ensureForge(mc, javaPath, onProgress) {
  const existing = V.listInstalled().filter((v) => v.loader === 'forge' && v.mc === mc);
  if (existing.length) {
    const id = existing[existing.length - 1].id;
    await installResolved(id, onProgress);
    return repairForge(mc, id, javaPath, onProgress);
  }
  return installForge(mc, javaPath, onProgress);
}

module.exports = { scanBad, repairForge, support, installFabric, ensureFabric, installForge, ensureForge, forgeInfo };
