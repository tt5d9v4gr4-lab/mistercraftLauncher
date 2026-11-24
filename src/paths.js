'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

const root =
  process.env.MISTERCRAFT_HOME ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), '.mistercraft');

const P = {
  root,
  versions: path.join(root, 'versions'),
  libraries: path.join(root, 'libraries'),
  assets: path.join(root, 'assets'),
  runtime: path.join(root, 'runtime'),
  tmp: path.join(root, 'tmp'),
  mods: path.join(root, 'mods'),
  skins: path.join(root, 'skins'),
  profiles: path.join(root, 'profiles'),
  /** Отдельное направление Medieval Fantasy: свои моды, миры, шейдеры, настройки. */
  mf: path.join(root, 'MedievalFantasy'),
  /** Папка игры для пары «версия + загрузчик»: свои моды, миры, настройки. */
  profileDir(mc, loader) {
    const safe = (x) => String(x).replace(/[^\w.+\-]/g, '_');
    const l = ['fabric', 'forge'].includes(loader) ? loader : 'vanilla';
    return path.join(P.profiles, `${safe(mc)}-${l}`);
  },
  settings: path.join(root, 'launcher_settings.json'),
  manifest: path.join(root, 'version_manifest.json'),
  ensure() {
    for (const k of ['root', 'versions', 'libraries', 'assets', 'runtime', 'tmp', 'mods']) {
      fs.mkdirSync(P[k], { recursive: true });
    }
  },
};

module.exports = P;
