'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { getJson } = require('./http');

const MANIFEST_URL =
  process.env.MC_MANIFEST_URL || 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

function versionJsonPath(id) {
  return path.join(P.versions, id, id + '.json');
}

function validId(id) {
  return typeof id === 'string' && /^[\w.+\- ]{1,100}$/.test(id) && !id.includes('..');
}

async function getManifest() {
  P.ensure();
  try {
    const m = await getJson(MANIFEST_URL);
    fs.writeFileSync(P.manifest, JSON.stringify(m));
    return { ...m, offline: false };
  } catch (e) {
    if (fs.existsSync(P.manifest)) return { ...readJson(P.manifest), offline: true };
    throw new Error('Не удалось загрузить список версий. Проверьте подключение к интернету.');
  }
}

function merge(parent, child) {
  const m = { ...parent, ...child };
  m.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments || child.arguments) {
    m.arguments = {
      game: [...((parent.arguments && parent.arguments.game) || []), ...((child.arguments && child.arguments.game) || [])],
      jvm: [...((parent.arguments && parent.arguments.jvm) || []), ...((child.arguments && child.arguments.jvm) || [])],
    };
  }
  m.id = child.id;
  m.jarId = child.jar || parent.jarId;
  return m;
}

/** Читает version.json и разворачивает inheritsFrom (Fabric/Forge). */
function loadResolved(id, seen = new Set()) {
  if (seen.has(id)) throw new Error('Циклическое наследование версий: ' + id);
  seen.add(id);
  const p = versionJsonPath(id);
  if (!fs.existsSync(p)) throw new Error(`Версия ${id} не установлена`);
  const j = readJson(p);
  j.id = j.id || id;
  if (!j.inheritsFrom) return { ...j, jarId: j.jar || j.id };
  const parent = loadResolved(j.inheritsFrom, seen);
  return merge(parent, j);
}

function loaderKind(id) {
  if (/fabric/i.test(id)) return 'fabric';
  if (/forge/i.test(id)) return 'forge';
  if (/quilt/i.test(id)) return 'quilt';
  return 'vanilla';
}

function listInstalled() {
  if (!fs.existsSync(P.versions)) return [];
  const out = [];
  for (const id of fs.readdirSync(P.versions)) {
    const jp = versionJsonPath(id);
    if (!fs.existsSync(jp)) continue;
    try {
      const j = readJson(jp);
      const parent = j.inheritsFrom || null;
      const jarId = j.jar || parent || id;
      out.push({
        id,
        type: j.type || 'release',
        parent,
        mc: parent || id,
        loader: loaderKind(id),
        ready: fs.existsSync(path.join(P.versions, id, '.installed')),
        hasJar: fs.existsSync(path.join(P.versions, jarId, jarId + '.jar')),
      });
    } catch { /* повреждённый json пропускаем */ }
  }
  return out;
}

function deleteVersion(id) {
  if (!validId(id)) throw new Error('Недопустимое имя версии');
  const dir = path.join(P.versions, id);
  if (!path.resolve(dir).startsWith(path.resolve(P.versions) + path.sep)) throw new Error('Недопустимый путь');
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { getManifest, loadResolved, listInstalled, deleteVersion, versionJsonPath, readJson, validId, loaderKind, merge };
