'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const P = require('./paths');
const { download, getJson } = require('./http');
const { extractZip } = require('./zip');

function requiredMajor(resolved) {
  const m = (resolved.javaVersion && resolved.javaVersion.majorVersion) || 8;
  return m;
}

/** Какую Java реально берём: 16 -> 17 (Adoptium 16 уже не поддерживается). */
function targetMajor(required) {
  return required === 16 ? 17 : required;
}

function parseMajor(text) {
  const m = /version "([^"]+)"/.exec(text) || /openjdk (\d+)/i.exec(text);
  if (!m) return null;
  const v = m[1];
  if (v.startsWith('1.')) return parseInt(v.split('.')[1], 10);
  return parseInt(v.split(/[.\-+_]/)[0], 10);
}

function probe(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 10000, windowsHide: true }, (err, so, se) => {
      const major = parseMajor(String(se || '') + String(so || ''));
      resolve(major ? { path: javaPath, major } : null);
    });
  });
}

function safeReaddir(d) {
  try { return fs.readdirSync(d); } catch { return []; }
}

function candidatePaths() {
  const c = [];
  const add = (p) => { if (p && fs.existsSync(p)) c.push(p); };
  if (process.env.JAVA_HOME) add(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));

  // Собственные runtime лаунчера
  for (const d of safeReaddir(P.runtime)) add(path.join(P.runtime, d, 'bin', 'java.exe'));

  const bases = [];
  for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (!pf) continue;
    for (const v of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru', 'AdoptOpenJDK']) bases.push(path.join(pf, v));
  }
  bases.push(path.join(os.homedir(), '.jdks'));
  for (const b of bases) for (const d of safeReaddir(b)) add(path.join(b, d, 'bin', 'java.exe'));

  // Java официального лаунчера Minecraft
  const mojang = path.join(process.env.APPDATA || '', '.minecraft', 'runtime');
  for (const name of safeReaddir(mojang)) {
    const plat = path.join(mojang, name, 'windows-x64', name, 'bin', 'java.exe');
    add(plat);
  }
  return c;
}

function whereJava() {
  return new Promise((resolve) => {
    execFile('where', ['java'], { timeout: 5000, windowsHide: true }, (err, so) => {
      resolve(err ? [] : String(so).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}

async function findJavas() {
  const paths = [...candidatePaths(), ...(await whereJava())];
  const uniq = [...new Map(paths.map((p) => [p.toLowerCase(), p])).values()];
  const res = (await Promise.all(uniq.map(probe))).filter(Boolean);
  return res.sort((a, b) => a.major - b.major);
}

function findJavaExe(dir, depth = 3) {
  const direct = path.join(dir, 'bin', 'java.exe');
  if (fs.existsSync(direct)) return direct;
  if (depth === 0) return null;
  for (const e of safeReaddir(dir)) {
    const p = path.join(dir, e);
    try {
      if (fs.statSync(p).isDirectory()) {
        const f = findJavaExe(p, depth - 1);
        if (f) return f;
      }
    } catch {}
  }
  return null;
}

function javaOk(major, need) {
  return need <= 8 ? major === 8 : major >= need;
}

async function jreSource(need) {
  const fallback = { url: `https://api.adoptium.net/v3/binary/latest/${need}/ga/windows/x64/jre/hotspot/normal/eclipse` };
  try {
    const j = await getJson(`https://api.adoptium.net/v3/assets/latest/${need}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`);
    const pkg = j[0] && j[0].binary && j[0].binary.package;
    if (pkg && pkg.link && pkg.checksum) return { url: pkg.link, sha256: pkg.checksum };
  } catch { /* используем прямую ссылку без проверки суммы */ }
  return fallback;
}

/** Системный tar.exe (есть в Windows 10/11) надёжно распаковывает zip. */
function tarExtract(zip, dest) {
  return new Promise((resolve, reject) => {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (!fs.existsSync(tar)) return reject(new Error('tar.exe не найден'));
    execFile(tar, ['-xf', zip, '-C', dest], { timeout: 300000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
  });
}

async function downloadJre(need, onProgress) {
  const dir = path.join(P.runtime, `jre-${need}`);
  const tmpDir = dir + '.tmp';
  const zip = path.join(P.tmp, `jre-${need}.zip`);
  const cleanup = () => {
    fs.rmSync(zip, { force: true });
    fs.rmSync(zip + '.part', { force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
      onProgress(null, `Загрузка Java ${need}…`);
      const src = await jreSource(need);
      let bytes = 0;
      let last = 0;
      await download(src.url, zip, {
        sha256: src.sha256,
        onBytes: (n) => {
          bytes += n;
          const now = Date.now();
          if (now - last > 200) {
            last = now;
            onProgress(null, `Загрузка Java ${need}… ${(Math.max(0, bytes) / 1048576).toFixed(0)} МБ`);
          }
        },
      });
      onProgress(null, `Установка Java ${need}…`);
      fs.mkdirSync(tmpDir, { recursive: true });
      try {
        await tarExtract(zip, tmpDir);
        if (!findJavaExe(tmpDir)) throw new Error('пусто');
      } catch {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        extractZip(zip, tmpDir);
      }
      if (!findJavaExe(tmpDir)) throw new Error(`Не удалось установить Java ${need}`);
      fs.renameSync(tmpDir, dir);
      const exe = findJavaExe(dir);
      if (!exe || !(await probe(exe))) throw new Error(`Java ${need} скачана, но не запускается. Проверьте антивирус.`);
      fs.rmSync(zip, { force: true });
      return exe;
    } catch (e) {
      lastErr = e;
      cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
      onProgress(null, `Ошибка загрузки Java, повтор (${attempt + 1}/3)…`);
    }
  }
  throw new Error('Не удалось скачать и установить Java: ' + (lastErr && lastErr.message ? lastErr.message : lastErr));
}

/**
 * Возвращает путь к java.exe для нужной версии.
 * setting === 'auto' — подбор или загрузка, иначе — путь, выбранный пользователем.
 */
async function ensureJava(required, setting, onProgress = () => {}) {
  const need = targetMajor(required);
  if (setting && setting !== 'auto') {
    if (!fs.existsSync(setting)) throw new Error('Выбранный файл Java не найден: ' + setting);
    const info = await probe(setting);
    if (!info) throw new Error('Не удалось определить версию выбранной Java');
    if (!javaOk(info.major, need)) {
      throw new Error(
        need <= 8
          ? `Для этой версии Minecraft нужна именно Java 8, а выбрана Java ${info.major}`
          : `Для этой версии Minecraft нужна Java ${need} или новее, а выбрана Java ${info.major}`
      );
    }
    return setting;
  }

  const managed = path.join(P.runtime, `jre-${need}`);
  const m = fs.existsSync(managed) ? findJavaExe(managed) : null;
  if (m) {
    if (await probe(m)) return m;
    // Повреждённая/неполная Java лаунчера — удаляем, скачаем заново
    onProgress(null, `Java ${need} повреждена, загружаю заново…`);
    fs.rmSync(managed, { recursive: true, force: true });
  }

  const found = (await findJavas()).filter((j) => javaOk(j.major, need));
  if (found.length) {
    found.sort((a, b) => Math.abs(a.major - need) - Math.abs(b.major - need));
    return found[0].path;
  }
  return downloadJre(need, onProgress);
}

module.exports = { requiredMajor, targetMajor, parseMajor, findJavas, ensureJava, javaOk };
