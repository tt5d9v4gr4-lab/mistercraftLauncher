'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const V = require('./versions');
const { fetchRetry, download } = require('./http');

const API = process.env.MODRINTH_API_URL || 'https://api.modrinth.com/v2';
const TEST_MODE = !!process.env.MODRINTH_API_URL;
const HEADERS = { 'User-Agent': 'MisterCraftLauncher/1.0.0 (Minecraft launcher)', Accept: 'application/json' };
const LOADER_NAME = { fabric: 'Fabric', forge: 'Forge' };
const SORTS = ['relevance', 'downloads', 'follows', 'newest', 'updated'];
const RANK = { release: 3, beta: 2, alpha: 1 };

// ---------- профиль ----------
function ctx(mc, loader, space) {
  if (space === 'mf') {
    if (mc !== '1.20.1' || loader !== 'forge') throw new Error('Medieval Fantasy работает только на Minecraft 1.20.1 и Forge.');
    return { mc, loader, dir: P.mf, mods: path.join(P.mf, 'mods'), reg: path.join(P.mf, 'mods.json') };
  }
  if (!V.validId(mc)) throw new Error('Не выбрана версия Minecraft');
  if (!LOADER_NAME[loader]) throw new Error('Моды доступны для Fabric и Forge. Выберите загрузчик на главном экране.');
  const dir = P.profileDir(mc, loader);
  return { mc, loader, dir, mods: path.join(dir, 'mods'), reg: path.join(dir, 'mods.json') };
}
const okId = (id) => typeof id === 'string' && /^[\w\-]{1,64}$/.test(id);

function readReg(reg) {
  try { return JSON.parse(fs.readFileSync(reg, 'utf8')); } catch { return {}; }
}
function writeReg(reg, o) {
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  fs.writeFileSync(reg + '.tmp', JSON.stringify(o, null, 2));
  fs.renameSync(reg + '.tmp', reg);
}

// ---------- безопасность ----------
function checkUrl(u) {
  let x;
  try { x = new URL(u); } catch { throw new Error('Некорректная ссылка на файл мода'); }
  if (TEST_MODE && x.hostname === '127.0.0.1') return;
  if (x.protocol !== 'https:' || !/(^|\.)modrinth\.com$/.test(x.hostname)) {
    throw new Error('Файл находится не на Modrinth — загрузка отклонена.');
  }
}
function safeFile(n, ext = 'jar') {
  const b = path.basename(String(n || ''));
  if (b !== n || !new RegExp(`^[\\w.+\\-() \\[\\]]{1,150}\\.${ext}$`, 'i').test(b)) throw new Error('Недопустимое имя файла: ' + n);
  return b;
}

// ---------- Modrinth API ----------
async function api(p, { query, method = 'GET', body } = {}) {
  const url = new URL(API + p);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  let r;
  try {
    r = await fetchRetry(url.toString(), {
      method,
      headers: { ...HEADERS, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Не удалось связаться с Modrinth. Проверьте подключение к интернету.');
  }
  if (r.status === 429) throw new Error('Modrinth: слишком много запросов. Подождите минуту и повторите.');
  if (!r.ok) {
    const e = new Error(`Modrinth ответил ошибкой ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

function pickVersion(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((v) => v.version_type === 'release') || list.find((v) => v.version_type === 'beta') || list[0];
}
function primaryFile(ver, ext = 'jar') {
  const re = new RegExp(`\\.${ext}$`, 'i');
  const f = (ver.files || []).find((x) => x.primary && re.test(x.filename)) || (ver.files || []).find((x) => re.test(x.filename));
  if (!f) throw new Error(`У этой версии нет файла .${ext}`);
  if (!f.hashes || !f.hashes.sha1) throw new Error('У файла мода нет контрольной суммы — установка отклонена.');
  return { url: f.url, filename: f.filename, sha1: f.hashes.sha1, size: f.size || 0 };
}

async function explain(pid, title, mc, loader) {
  const ln = LOADER_NAME[loader];
  try {
    const all = await api(`/project/${encodeURIComponent(pid)}/version`);
    const forMc = all.filter((v) => v.game_versions.includes(mc));
    if (forMc.length) {
      const ls = [...new Set(forMc.flatMap((v) => v.loaders))].map((l) => LOADER_NAME[l] || l);
      return `У мода «${title}» нет версии для ${ln} на Minecraft ${mc}. Для этой версии игры он есть только для: ${ls.join(', ')}.`;
    }
    const vs = [...new Set(all.filter((v) => v.loaders.includes(loader)).flatMap((v) => v.game_versions))];
    vs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (vs.length) return `Мод «${title}» не выпускался для Minecraft ${mc}. Для ${ln} он есть для версий: ${vs.slice(0, 6).join(', ')}.`;
    return `Мод «${title}» не поддерживает ${ln}.`;
  } catch {
    return `Для мода «${title}» нет версии под Minecraft ${mc} и ${ln}.`;
  }
}

// ---------- поиск и страница мода ----------
async function search({ mc, loader, q, sort, category, onlyCompat = true, offset = 0 }) {
  const facets = [['project_type:mod']];
  if (LOADER_NAME[loader]) facets.push([`categories:${loader}`]);
  if (onlyCompat && V.validId(mc)) facets.push([`versions:${mc}`]);
  if (category && /^[\w\-]{1,40}$/.test(category)) facets.push([`categories:${category}`]);
  const r = await api('/search', {
    query: {
      query: q ? String(q).slice(0, 80) : undefined,
      facets,
      index: SORTS.includes(sort) ? sort : 'downloads',
      offset: Math.max(0, Math.min(10000, Number(offset) || 0)),
      limit: 20,
    },
  });
  return {
    total: r.total_hits || 0,
    hits: (r.hits || []).map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, author: h.author,
      downloads: h.downloads, icon: h.icon_url || null, categories: h.display_categories || h.categories || [],
    })),
  };
}

async function project({ mc, loader, projectId, space }) {
  if (!okId(projectId)) throw new Error('Некорректный мод');
  const c = ctx(mc, loader, space);
  const p = await api(`/project/${encodeURIComponent(projectId)}`);
  let author = '';
  try {
    const m = await api(`/project/${encodeURIComponent(projectId)}/members`);
    const owner = m.find((x) => x.role === 'Owner') || m[0];
    author = owner && owner.user ? owner.user.username : '';
  } catch {}
  let compat;
  const ver = pickVersion(await api(`/project/${encodeURIComponent(projectId)}/version`, { query: { game_versions: [c.mc], loaders: [c.loader] } }));
  if (ver) compat = { ok: true, versionNumber: ver.version_number, versionName: ver.name, type: ver.version_type };
  else compat = { ok: false, reason: await explain(p.id, p.title, c.mc, c.loader) };
  const body = String(p.body || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~|]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1800);
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description, author, body,
    icon: p.icon_url || null, downloads: p.downloads, followers: p.followers,
    loaders: p.loaders || [], versions: (p.game_versions || []).slice(-8),
    gallery: (p.gallery || []).map((g) => ({ url: g.url, title: g.title || '' })).filter((g) => /^https:\/\/cdn\.modrinth\.com\//.test(g.url)).slice(0, 6),
    compat,
  };
}

// ---------- план установки (зависимости и совместимость) ----------
async function buildPlan(mc, loader, projectId, versionId, space) {
  const c = ctx(mc, loader, space);
  if (!okId(projectId)) throw new Error('Некорректный мод');
  const reg = readReg(c.reg);
  const has = (pid) => reg[pid] && fs.existsSync(path.join(c.mods, reg[pid].filename));
  const items = [];
  const seen = new Set();
  const optional = new Set();

  const visit = async (pid, vid, isDep, depth) => {
    if (seen.has(pid) || depth > 6) return;
    seen.add(pid);
    const project = await api(`/project/${encodeURIComponent(pid)}`);
    seen.add(project.id);
    pid = project.id;
    let ver = null;
    if (vid) {
      try {
        const v = await api(`/version/${encodeURIComponent(vid)}`);
        if (v.game_versions.includes(mc) && v.loaders.includes(loader)) ver = v;
      } catch { /* возьмём подходящую версию ниже */ }
    }
    if (!ver) ver = pickVersion(await api(`/project/${encodeURIComponent(pid)}/version`, { query: { game_versions: [mc], loaders: [loader] } }));
    if (!ver) throw new Error(await explain(pid, project.title, mc, loader));
    if (has(pid) && reg[pid].versionId === ver.id) return; // уже установлено

    const file = primaryFile(ver);
    const inc = (ver.dependencies || []).filter((d) => d.dependency_type === 'incompatible' && d.project_id).map((d) => d.project_id);
    for (const other of inc) {
      if (has(other) || items.some((i) => i.projectId === other)) {
        throw new Error(`Мод «${project.title}» несовместим с установленным модом «${(reg[other] && reg[other].title) || other}». Удалите один из них.`);
      }
    }
    for (const [opid, e] of Object.entries(reg)) {
      if (opid !== pid && (e.incompatible || []).includes(pid) && has(opid)) {
        throw new Error(`Установленный мод «${e.title}» несовместим с «${project.title}». Удалите его, чтобы установить этот мод.`);
      }
    }

    const requires = [];
    for (const d of ver.dependencies || []) {
      let dp = d.project_id;
      if (!dp && d.version_id) { try { dp = (await api(`/version/${encodeURIComponent(d.version_id)}`)).project_id; } catch {} }
      if (!dp) continue;
      if (d.dependency_type === 'required') {
        requires.push(dp);
        if (!has(dp)) await visit(dp, d.version_id, true, depth + 1);
      } else if (d.dependency_type === 'optional' && !has(dp)) {
        optional.add(dp);
      }
    }
    items.push({
      projectId: pid, slug: project.slug, title: project.title, icon: project.icon_url || null,
      versionId: ver.id, versionNumber: ver.version_number, versionType: ver.version_type,
      isDep, file, requires, incompatible: inc,
    });
  };

  await visit(projectId, versionId, false, 0);

  let opt = [];
  const ids = [...optional].filter((id) => !seen.has(id)).slice(0, 6);
  if (ids.length) {
    try { opt = (await api('/projects', { query: { ids } })).map((p) => ({ id: p.id, title: p.title })); } catch {}
  }
  return { items, optional: opt };
}

async function plan({ mc, loader, projectId, versionId, space }) {
  const p = await buildPlan(mc, loader, projectId, versionId, space);
  return {
    items: p.items.map((i) => ({ projectId: i.projectId, title: i.title, versionNumber: i.versionNumber, isDep: i.isDep, size: i.file.size })),
    optional: p.optional,
  };
}

// ---------- установка ----------
async function install({ mc, loader, projectId, versionId, space }, { onProgress = () => {}, signal } = {}) {
  const { items } = await buildPlan(mc, loader, projectId, versionId, space);
  if (!items.length) return { installed: [] };
  const c = ctx(mc, loader, space);
  fs.mkdirSync(c.mods, { recursive: true });

  const total = items.reduce((s, i) => s + (i.file.size || 0), 0) || 1;
  let done = 0;
  let last = 0;
  const created = [];
  try {
    for (const it of items) {
      if (signal && signal.aborted) throw new Error('Загрузка отменена');
      checkUrl(it.file.url);
      const dest = path.join(c.mods, safeFile(it.file.filename));
      const existed = fs.existsSync(dest);
      let got = 0;
      onProgress({ text: `Загрузка: ${it.title}`, percent: Math.round((done / total) * 100) });
      await download(it.file.url, dest, {
        sha1: it.file.sha1,
        signal,
        onBytes: (n) => {
          got += n;
          const now = Date.now();
          if (now - last > 150) {
            last = now;
            onProgress({ text: `Загрузка: ${it.title}`, percent: Math.min(99, Math.round(((done + Math.max(0, got)) / total) * 100)) });
          }
        },
      });
      if (!existed) created.push(dest);
      done += it.file.size || got;
    }
  } catch (e) {
    for (const f of created) { try { fs.unlinkSync(f); } catch {} }
    throw e;
  }

  const reg = readReg(c.reg);
  for (const it of items) {
    const old = reg[it.projectId];
    if (old && old.filename !== it.file.filename) { try { fs.unlinkSync(path.join(c.mods, safeFile(old.filename))); } catch {} }
    reg[it.projectId] = {
      title: it.title, slug: it.slug, icon: it.icon, versionId: it.versionId, versionNumber: it.versionNumber,
      versionType: it.versionType, filename: it.file.filename, sha1: it.file.sha1,
      isDep: it.isDep && (!old || old.isDep), requires: it.requires, incompatible: it.incompatible,
      installedAt: new Date().toISOString(),
    };
  }
  writeReg(c.reg, reg);
  onProgress({ text: 'Готово', percent: 100 });
  return { installed: items.map((i) => ({ projectId: i.projectId, title: i.title, versionNumber: i.versionNumber, isDep: i.isDep })) };
}

// ---------- список, удаление, обновления ----------
function list({ mc, loader, space }) {
  const c = ctx(mc, loader, space);
  const reg = readReg(c.reg);
  const entries = [];
  let changed = false;
  for (const [pid, e] of Object.entries(reg)) {
    if (!fs.existsSync(path.join(c.mods, e.filename))) { delete reg[pid]; changed = true; continue; }
    entries.push({ projectId: pid, title: e.title, slug: e.slug, icon: e.icon, versionNumber: e.versionNumber, filename: e.filename, isDep: !!e.isDep, requires: e.requires || [] });
  }
  if (changed) writeReg(c.reg, reg);
  for (const e of entries) e.requiredBy = entries.filter((o) => o.requires.includes(e.projectId)).map((o) => o.title);
  const known = new Set(entries.map((e) => e.filename));
  const manual = [];
  if (fs.existsSync(c.mods)) {
    for (const f of fs.readdirSync(c.mods)) {
      if (/\.jar$/i.test(f) && !known.has(f)) manual.push({ filename: f, size: fs.statSync(path.join(c.mods, f)).size });
    }
  }
  return { entries, manual };
}

function remove({ mc, loader, projectId, filename, space }) {
  const c = ctx(mc, loader, space);
  const reg = readReg(c.reg);
  if (projectId) {
    const e = reg[projectId];
    if (!e) return;
    try { fs.unlinkSync(path.join(c.mods, safeFile(e.filename))); } catch {}
    delete reg[projectId];
    writeReg(c.reg, reg);
  } else if (filename) {
    try { fs.unlinkSync(path.join(c.mods, safeFile(filename))); } catch {}
  }
}

async function updates({ mc, loader, space }) {
  const c = ctx(mc, loader, space);
  const reg = readReg(c.reg);
  const byHash = {};
  for (const [pid, e] of Object.entries(reg)) {
    if (e.sha1 && fs.existsSync(path.join(c.mods, e.filename))) byHash[e.sha1] = pid;
  }
  if (!Object.keys(byHash).length) return [];
  const res = await api('/version_files/update', { method: 'POST', body: { hashes: Object.keys(byHash), algorithm: 'sha1', loaders: [loader], game_versions: [mc] } });
  const out = [];
  for (const [h, v] of Object.entries(res || {})) {
    const pid = byHash[h];
    if (!pid || v.id === reg[pid].versionId) continue;
    if ((RANK[v.version_type] || 0) < (RANK[reg[pid].versionType] || 3)) continue; // не «обновляем» релиз до беты
    out.push({ projectId: pid, versionId: v.id, versionNumber: v.version_number });
  }
  return out;
}

module.exports = { search, project, plan, install, list, remove, updates, checkUrl, safeFile, api, pickVersion, primaryFile };
