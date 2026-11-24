'use strict';
/**
 * MisterCraft: Medieval Fantasy — отдельное направление.
 * Свои данные: %APPDATA%\.mistercraft\MedievalFantasy (mods, saves, shaderpacks, resourcepacks, config, options.txt).
 * Файлы игры (versions, libraries, assets) общие и неизменяемые, поэтому с обычным Minecraft не конфликтуют.
 */
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const V = require('./versions');
const mods = require('./mods');
const { download } = require('./http');

const MC = '1.20.1';
const LOADER = 'forge';
const EXTRA = {
  shader: { dir: 'shaderpacks', title: 'Шейдеры', ext: 'zip' },
  resourcepack: { dir: 'resourcepacks', title: 'Текстуры', ext: 'zip' },
  datapack: { dir: path.join('config', 'paxi', 'datapacks'), title: 'Датапаки', ext: 'zip' },
};

const PRESETS = {
  light: { label: 'Лёгкий', renderDistance: 10, simulationDistance: 8, shaders: false, ramMb: 4096 },
  balanced: { label: 'Сбалансированный', renderDistance: 16, simulationDistance: 10, shaders: true, ramMb: 6144 },
  ultra: { label: 'Ультра', renderDistance: 32, simulationDistance: 16, shaders: true, ramMb: 10240 },
};

const file = (...p) => path.join(P.mf, ...p);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f); };

// ---------- сборка (манифест) ----------
function loadPack() {
  const custom = file('pack.json');
  const src = fs.existsSync(custom) ? custom : path.join(__dirname, 'mf', 'pack.json');
  const j = JSON.parse(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''));
  if (j.mc !== MC || j.loader !== LOADER) throw new Error(`Сборка Medieval Fantasy должна быть для Minecraft ${MC} и ${LOADER}.`);
  return j;
}

// ---------- настройки ----------
function getSettings() {
  const s = { ramMb: 6144, preset: 'balanced', renderDistance: 16, simulationDistance: 10, shader: null, ...readJson(file('mf-settings.json'), {}) };
  return s;
}
function setSettings(patch) {
  const s = getSettings();
  const clamp = (v, a, b, d) => Math.max(a, Math.min(b, Math.round(Number(v)) || d));
  if ('ramMb' in patch) s.ramMb = clamp(patch.ramMb, 2048, 65536, 6144);
  if ('renderDistance' in patch) s.renderDistance = clamp(patch.renderDistance, 2, 48, 16);
  if ('simulationDistance' in patch) s.simulationDistance = clamp(patch.simulationDistance, 5, 32, 10);
  if ('preset' in patch) s.preset = PRESETS[patch.preset] || patch.preset === 'custom' ? patch.preset : s.preset;
  if ('shader' in patch) {
    if (patch.shader === null) s.shader = null;
    else {
      const name = path.basename(String(patch.shader));
      if (!fs.existsSync(file('shaderpacks', name))) throw new Error('Такого шейдера нет в папке shaderpacks.');
      s.shader = name;
    }
  }
  writeJson(file('mf-settings.json'), s);
  return s;
}
function applyPreset(id) {
  const p = PRESETS[id];
  if (!p) throw new Error('Неизвестный профиль');
  const s = setSettings({ preset: id, renderDistance: p.renderDistance, simulationDistance: p.simulationDistance, ramMb: p.ramMb });
  return { ...s, shadersWanted: p.shaders };
}

/** Меняет/добавляет строки «ключ<sep>значение», остальное сохраняет. */
function patchKeyFile(f, kv, sep) {
  let lines = [];
  try { lines = fs.readFileSync(f, 'utf8').split(/\r?\n/); } catch {}
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const left = { ...kv };
  lines = lines.map((l) => {
    const i = l.indexOf(sep);
    const k = i > 0 ? l.slice(0, i) : null;
    if (k && k in left) { const v = left[k]; delete left[k]; return v === null ? null : `${k}${sep}${v}`; }
    return l;
  }).filter((l) => l !== null);
  for (const [k, v] of Object.entries(left)) if (v !== null) lines.push(`${k}${sep}${v}`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, lines.join('\n') + '\n');
}

/** Графический профиль → options.txt и конфиг Oculus (выбранный шейдер). */
function applyGraphics() {
  const s = getSettings();
  const preset = PRESETS[s.preset];
  patchKeyFile(file('options.txt'), { renderDistance: s.renderDistance, simulationDistance: s.simulationDistance }, ':');
  const wantShaders = preset ? preset.shaders : !!s.shader;
  const on = !!(wantShaders && s.shader && fs.existsSync(file('shaderpacks', s.shader)));
  patchKeyFile(file('config', 'oculus.properties'), { enableShaders: on ? 'true' : 'false', shaderPack: on ? s.shader : null }, '=');
  return { shadersOn: on };
}

// ---------- состояние ----------
function forgeVersion() {
  return V.listInstalled().filter((v) => v.loader === 'forge' && v.mc === MC && v.ready).map((v) => v.id).pop() || null;
}
function status() {
  const state = readJson(file('pack-state.json'), null);
  const pack = loadPack();
  let count = 0;
  try { count = mods.list({ mc: MC, loader: LOADER, space: 'mf' }).entries.length; } catch {}
  return { name: pack.name, mc: MC, loader: 'Forge', packVersion: pack.version, installed: !!(state && forgeVersion()), forgeId: forgeVersion(), modsCount: count, state, dir: P.mf };
}

// ---------- установка сборки ----------
const reasonOf = (e) => (e && e.status === 404 ? 'не найден на Modrinth' : (e && e.message) || String(e));

async function installMods(pack, { onProgress = () => {}, signal } = {}) {
  const active = pack.mods.filter((m) => !m.disabled);
  const report = { installed: [], failed: [], skipped: pack.mods.filter((m) => m.disabled).map((m) => ({ title: m.title || m.slug, reason: m.reason || 'отключён в манифесте' })), total: active.length };
  let i = 0;
  for (const entry of active) {
    i++;
    const cands = [entry.slug, ...(entry.alternatives || [])];
    let ok = false;
    let reason = '';
    for (const slug of cands) {
      try {
        const r = await mods.install({ mc: MC, loader: LOADER, projectId: slug, space: 'mf' }, {
          signal,
          onProgress: (p) => onProgress({ text: `Моды (${i}/${active.length}): ${entry.title || slug}`, percent: Math.round(((i - 1) / active.length) * 100 + (p.percent || 0) / active.length) }),
        });
        const main = r.installed.find((x) => !x.isDep);
        if (!main) report.installed.push(`${entry.title || slug} (уже установлен)`);
        else report.installed.push(slug === entry.slug ? main.title : `${main.title} (вместо ${entry.title || entry.slug})`);
        report.installed.push(...r.installed.filter((x) => x.isDep).map((x) => x.title + ' (зависимость)'));
        ok = true;
        break;
      } catch (e) {
        if (signal && signal.aborted) throw new Error('Загрузка отменена');
        if (/отменена/.test(e.message)) throw e;
        reason = reasonOf(e);
      }
    }
    if (!ok) report.failed.push({ title: entry.title || entry.slug, required: !!entry.required, reason });
  }
  return report;
}

/** Установка шейдера или текстур с Modrinth (только версии для 1.20.1). */
async function installExtra({ kind, slug }, { signal, onProgress = () => {} } = {}) {
  const cfg = EXTRA[kind];
  if (!cfg) throw new Error('Неизвестный тип');
  if (!/^[\w\-]{1,64}$/.test(String(slug))) throw new Error('Некорректный проект');
  const p = await mods.api(`/project/${encodeURIComponent(slug)}`);
  if (p.project_type !== kind) throw new Error(`«${p.title}» — это не ${kind === 'shader' ? 'шейдер' : 'набор текстур'}.`);
  const list = await mods.api(`/project/${encodeURIComponent(p.id)}/version`, { query: { game_versions: [MC] } });
  const ver = mods.pickVersion(list);
  if (!ver) throw new Error(`У «${p.title}» нет версии для Minecraft ${MC}.`);
  const f = mods.primaryFile(ver, cfg.ext);
  mods.checkUrl(f.url);
  const name = mods.safeFile(f.filename, cfg.ext);
  fs.mkdirSync(file(cfg.dir), { recursive: true });
  onProgress({ text: `Загрузка: ${p.title}`, percent: 0 });
  await download(f.url, file(cfg.dir, name), {
    sha1: f.sha1, signal,
    onBytes: () => {},
  });
  const reg = readJson(file('extras.json'), {});
  reg[p.id] = { kind, slug: p.slug, title: p.title, filename: name, versionId: ver.id, sha1: f.sha1 };
  writeJson(file('extras.json'), reg);
  return { title: p.title, filename: name };
}

async function installPack(deps, { onProgress = () => {}, signal } = {}) {
  const { installer, loaders, javaMod, javaSetting } = deps;
  const pack = loadPack();
  fs.mkdirSync(file('mods'), { recursive: true });
  const step = (text, percent) => onProgress({ text, percent: percent == null ? null : percent });
  const sub = (a, b) => (pct, text) => step(text || '', pct == null ? null : Math.round(a + ((b - a) * pct) / 100));

  step(`Minecraft ${MC}…`, null);
  await installer.installVanilla(MC, sub(0, 10), P.mf);
  const javaPath = await javaMod.ensureJava(javaMod.requiredMajor(V.loadResolved(MC)), javaSetting, (pct, t) => step(t || '', null));
  step('Установка Forge…', null);
  const forgeId = await loaders.ensureForge(MC, javaPath, sub(10, 25));

  const report = await installMods(pack, { signal, onProgress: (p) => step(p.text, 25 + Math.round((p.percent || 0) * 0.6)) });

  report.extras = [];
  for (const [kind, list] of [['shader', pack.shaders || []], ['resourcepack', pack.resourcepacks || []], ['datapack', pack.datapacks || []]]) {
    for (const e of list) {
      step(`${EXTRA[kind].title}: ${e.title || e.slug}`, 90);
      try { report.extras.push((await installExtra({ kind, slug: e.slug }, { signal })).title); }
      catch (err) {
        if (/отменена/.test(err.message)) throw err;
        report.failed.push({ title: e.title || e.slug, required: false, reason: reasonOf(err) });
      }
    }
  }

  try { report.story = installStory(); } catch (e) { report.failed.push({ title: 'Сюжетные задания (датапак)', required: false, reason: e.message }); }
  try { enableResourcePacks(pack); } catch {}
  report.removedShaders = pack.removedShaders || [];

  const s = getSettings();
  if (!s.shader) {
    const first = shaders().installed[0];
    if (first) setSettings({ shader: first });
  }
  report.ok = !report.failed.some((f) => f.required);
  try { fs.writeFileSync(file('install-report.md'), reportMarkdown(report, pack)); } catch {}
  writeJson(file('pack-state.json'), { packId: pack.id, packVersion: pack.version, forgeId, installedAt: new Date().toISOString(), report });
  step('Готово', 100);
  return report;
}


function reportMarkdown(r, pack) {
  const L = [`# ${pack.name} ${pack.version} — отчёт об установке`, '', `Minecraft ${MC}, Forge. Установлено: ${r.installed.length}; не установлено: ${r.failed.length}; отключено в манифесте: ${(r.skipped || []).length}.`, '', '## Установлено'];
  r.installed.forEach((t) => L.push('- ' + t));
  (r.extras || []).forEach((t) => L.push('- ' + t + ' (шейдер / текстуры / датапак)'));
  L.push('', '## Не установлено (нет версии для 1.20.1 + Forge или ошибка)');
  r.failed.forEach((f) => L.push(`- ${f.title}: ${f.reason}`));
  L.push('', '## Отключено намеренно');
  (r.skipped || []).forEach((f) => L.push(`- ${f.title}: ${f.reason}`));
  (r.removedShaders || []).forEach((f) => L.push(`- шейдер ${f.slug}: ${f.reason}`));
  L.push('', 'Отчёт не означает, что игра запускается: проверьте запуск и пришлите лог.');
  return L.join('\n') + '\n';
}

// ---------- сюжет (датапак) и ресурс-паки ----------
/** Копирует встроенный датапак сюжета в config/paxi/datapacks (его подхватывает мод Paxi во всех мирах). */
function installStory() {
  const src = path.join(__dirname, 'mf', 'datapacks', 'mf_story');
  const dst = file('config', 'paxi', 'datapacks', 'mf_story');
  const copy = (a, b) => {
    fs.mkdirSync(b, { recursive: true });
    for (const n of fs.readdirSync(a)) {
      const x = path.join(a, n), y = path.join(b, n);
      if (fs.statSync(x).isDirectory()) copy(x, y); else fs.copyFileSync(x, y);
    }
  };
  copy(src, dst);
  return { path: dst, chains: 4 };
}

/** Включает установленные ресурс-паки в options.txt, но только если игрок сам ещё не выбирал паки. */
function enableResourcePacks(pack) {
  const reg = readJson(file('extras.json'), {});
  const order = (pack.resourcepacks || []).map((r) => r.slug);
  const files = Object.values(reg).filter((e) => e.kind === 'resourcepack').sort((a, b) => order.indexOf(a.slug || '') - order.indexOf(b.slug || '')).map((e) => `file/${e.filename}`);
  if (!files.length) return false;
  const f = file('options.txt');
  let cur = '';
  try { cur = (fs.readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith('resourcePacks:')) || ''); } catch {}
  if (cur && /file\//.test(cur)) return false; // игрок уже настроил
  patchKeyFile(f, { resourcePacks: JSON.stringify(['vanilla', 'mod_resources', ...files]) }, ':');
  return true;
}

// ---------- миры, шейдеры, обновления ----------
function worlds() {
  const dir = file('saves');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    const lv = path.join(dir, n, 'level.dat');
    if (fs.existsSync(lv)) out.push({ name: n, lastPlayed: fs.statSync(lv).mtimeMs });
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

function shaders() {
  const dir = file('shaderpacks');
  const installed = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.zip$/i.test(n) || fs.statSync(path.join(dir, n)).isDirectory()) : [];
  const pack = loadPack();
  return { installed, selected: getSettings().shader, recommended: (pack.shaders || []).map((x) => ({ slug: x.slug, title: x.title })) };
}

async function checkUpdates() {
  return mods.updates({ mc: MC, loader: LOADER, space: 'mf' });
}
async function updateAll({ onProgress = () => {}, signal } = {}) {
  const up = await checkUpdates();
  const done = [];
  const failed = [];
  for (const u of up) {
    try {
      await mods.install({ mc: MC, loader: LOADER, projectId: u.projectId, versionId: u.versionId, space: 'mf' }, { signal, onProgress });
      done.push(u.projectId);
    } catch (e) {
      if (/отменена/.test(e.message)) throw e;
      failed.push({ projectId: u.projectId, reason: e.message });
    }
  }
  return { updated: done.length, failed };
}

module.exports = { MC, LOADER, PRESETS, loadPack, getSettings, setSettings, applyPreset, applyGraphics, status, installMods, installExtra, installPack, worlds, shaders, checkUpdates, updateAll, forgeVersion, patchKeyFile, installStory, enableResourcePacks };
