'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const V = require('./versions');
const { allowed, mavenPath } = require('./rules');

const LAUNCHER_NAME = 'MisterCraft';
const LAUNCHER_VERSION = '1.0.0';

function libKey(name) {
  const p = name.split('@')[0].split(':');
  return p[0] + ':' + p[1] + (p[3] ? ':' + p[3] : '');
}

function libRelPath(lib) {
  if (lib.downloads) {
    if (lib.downloads.artifact && lib.downloads.artifact.path) return lib.downloads.artifact.path;
    return null; // только natives-классификаторы — в classpath не идут
  }
  return lib.name ? mavenPath(lib.name) : null;
}

function buildClasspath(resolved) {
  const cp = [];
  const seen = new Set();
  for (const lib of resolved.libraries || []) {
    if (!allowed(lib.rules)) continue;
    const rel = libRelPath(lib);
    if (!rel) continue;
    const key = libKey(lib.name);
    if (seen.has(key)) continue;
    seen.add(key);
    cp.push(path.join(P.libraries, rel));
  }
  cp.push(path.join(P.versions, resolved.jarId, resolved.jarId + '.jar'));
  return cp;
}

/**
 * Собирает аргументы запуска.
 * account: { name, uuid, type, mcToken }
 */
function build({ id, account, ramMb = 4096, gameDir = P.root, javaPath = 'java', quickPlay = null }) {
  const r = V.loadResolved(id);
  // Версии-надстройки (Forge/Fabric) наследуют клиент от ванильной. Forge 1.17+ исключает из модульного слоя
  // файл «${version_name}.jar», поэтому клиентский jar должен называться по id самой версии.
  if (r.jarId !== id && !r.jar) {
    const src = path.join(P.versions, r.jarId, r.jarId + '.jar');
    const dst = path.join(P.versions, id, id + '.jar');
    if (fs.existsSync(src) && (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size)) {
      fs.copyFileSync(src, dst);
    }
    if (fs.existsSync(dst)) r.jarId = id;
  }
  const cp = buildClasspath(r);
  const features = quickPlay ? { has_quick_plays_support: true, is_quick_play_singleplayer: true } : {};
  const indexId = r.assetIndex ? r.assetIndex.id : r.assets || 'legacy';
  const virtual = path.join(P.assets, 'virtual', indexId);

  let logArg = null;
  const logFile = r.logging && r.logging.client;
  if (logFile && logFile.argument && logFile.file) {
    logArg = logFile.argument.replace('${path}', path.join(P.assets, 'log_configs', logFile.file.id));
  }

  const token = account.mcToken || '0';
  const vars = {
    auth_player_name: account.name,
    version_name: r.id,
    game_directory: gameDir,
    assets_root: P.assets,
    assets_index_name: indexId,
    auth_uuid: account.uuid,
    auth_access_token: token,
    auth_session: `token:${token}:${account.uuid}`,
    auth_xuid: '0',
    clientid: '0',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    version_type: r.type || 'release',
    user_properties: '{}',
    game_assets: virtual,
    natives_directory: path.join(P.versions, id, 'natives'),
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: cp.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: P.libraries,
    quickPlayPath: path.join(gameDir, 'quickPlay', 'log.json'),
    quickPlaySingleplayer: quickPlay || '',
    path: logFile && logFile.file ? path.join(P.assets, 'log_configs', logFile.file.id) : '',
  };

  const sub = (s) => s.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const expand = (list) => {
    const out = [];
    for (const a of list) {
      if (typeof a === 'string') out.push(sub(a));
      else if (allowed(a.rules, undefined, features)) {
        const v = Array.isArray(a.value) ? a.value : [a.value];
        out.push(...v.map(sub));
      }
    }
    return out;
  };

  let jvm;
  let game;
  if (r.arguments) {
    jvm = expand(r.arguments.jvm || []);
    game = expand(r.arguments.game || []);
  } else {
    jvm = [
      `-Djava.library.path=${vars.natives_directory}`,
      `-Dminecraft.launcher.brand=${LAUNCHER_NAME}`,
      `-Dminecraft.launcher.version=${LAUNCHER_VERSION}`,
    ];
    game = sub(r.minecraftArguments || '').split(' ').filter(Boolean);
  }
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', vars.classpath);

  const mem = [`-Xmx${ramMb}M`, `-Xms${Math.min(512, ramMb)}M`];
  const args = [...mem, ...jvm];
  if (logArg) args.push(logArg);
  args.push(r.mainClass, ...game);

  return { javaPath, args, cwd: gameDir, resolved: r };
}

module.exports = { build, buildClasspath };
