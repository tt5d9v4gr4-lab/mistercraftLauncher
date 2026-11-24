'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const P = require('./src/paths');
const settings = require('./src/settings');
const V = require('./src/versions');
const installer = require('./src/installer');
const loaders = require('./src/loaders');
const javaMod = require('./src/java');
const auth = require('./src/auth');
const launch = require('./src/launch');

let win = null;
let state = 'idle'; // idle | installing | running
let gameProc = null;
let userStopped = false;
let authAbort = null;
const logBuf = [];

// ---------- хранение токенов ----------
settings.setCrypto({
  enc: (s) =>
    safeStorage.isEncryptionAvailable()
      ? 'enc1:' + safeStorage.encryptString(s).toString('base64')
      : 'raw:' + Buffer.from(s, 'utf8').toString('base64'),
  dec: (s) =>
    s.startsWith('enc1:')
      ? safeStorage.decryptString(Buffer.from(s.slice(5), 'base64'))
      : Buffer.from(s.replace(/^raw:/, ''), 'base64').toString('utf8'),
});

// ---------- утилиты ----------
const send = (ch, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(ch, data);
};
const setState = (s) => { state = s; send('state', s); };
const progress = (percent, text) => send('progress', { percent, text });
const pushLog = (line) => {
  logBuf.push(line);
  if (logBuf.length > 1500) logBuf.shift();
  send('log', line);
};

function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

// ---------- окно ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#0a0a0a',
    title: 'MisterCraft Launcher',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    P.ensure();
    createWindow();
  });
  app.on('window-all-closed', () => {
    if (gameProc) { /* игра продолжает работать независимо */ }
    app.quit();
  });
}

process.on('unhandledRejection', (e) => pushLog('[launcher] ' + (e && e.message ? e.message : e)));

// ---------- окно: кнопки ----------
handle('win:min', () => win && win.minimize());
handle('win:max', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
handle('win:close', () => win && win.close());

// ---------- информация ----------
handle('app:info', () => ({
  version: app.getVersion(),
  totalMb: Math.floor(os.totalmem() / 1048576),
  root: P.root,
}));

// ---------- версии ----------
handle('versions:manifest', async () => {
  const m = await V.getManifest();
  return {
    latest: m.latest,
    offline: m.offline,
    versions: m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
  };
});
handle('versions:installed', () => V.listInstalled());
handle('versions:delete', (id) => {
  if (state !== 'idle') throw new Error('Нельзя удалять версии во время установки или игры');
  V.deleteVersion(id);
});
handle('loaders:support', (mc) => {
  if (!V.validId(mc)) throw new Error('Недопустимая версия');
  return loaders.support(mc);
});

// ---------- настройки ----------
handle('settings:get', () => settings.getPublic());
handle('settings:set', (patch) => settings.update(patch || {}));

// ---------- аккаунты ----------
handle('accounts:list', () => settings.listAccounts());
handle('accounts:addOffline', (name) => {
  settings.saveAccount(auth.offlineAccount(String(name || '').trim()));
  return settings.listAccounts();
});
handle('accounts:select', (id) => { settings.setActive(id); return settings.listAccounts(); });
handle('accounts:remove', (id) => { settings.removeAccount(id); return settings.listAccounts(); });

handle('auth:microsoft', async () => {
  if (authAbort) throw new Error('Вход уже выполняется');
  const clientId = settings.getPublic().msClientId;
  authAbort = new AbortController();
  try {
    const acc = await auth.deviceLogin(clientId, (c) => send('auth:code', c), authAbort.signal);
    settings.saveAccount(acc);
    return settings.listAccounts();
  } finally {
    authAbort = null;
  }
});
handle('auth:cancel', () => { if (authAbort) authAbort.abort(); });

// ---------- Java ----------
handle('java:list', () => javaMod.findJavas());
handle('java:browse', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выберите java.exe',
    properties: ['openFile'],
    filters: [{ name: 'Java', extensions: ['exe'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- папки и ссылки ----------
handle('folder:open', async (which, prof) => {
  P.ensure();
  let target = P.root;
  if (which === 'mods') {
    if (prof && prof.space === 'mf') target = path.join(P.mf, 'mods');
    else target = prof && prof.mc && V.validId(prof.mc) ? path.join(P.profileDir(prof.mc, prof.loader), 'mods') : P.mods;
    fs.mkdirSync(target, { recursive: true });
  }
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
});
handle('link:open', (url) => {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Недопустимая ссылка');
  return shell.openExternal(url);
});

// ---------- скины ----------
const skins = require('./src/skins');
handle('skins:list', () => skins.list());
handle('skins:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выберите PNG-скин',
    properties: ['openFile'],
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (r.canceled) return null;
  const file = r.filePaths[0];
  const base = path.basename(file, path.extname(file)).replace(/[^\p{L}\p{N} _\-]/gu, '_').slice(0, 32) || 'skin';
  return skins.save(base, fs.readFileSync(file), 'classic', { unique: true });
});
handle('skins:save', ({ name, dataUrl, variant, replace }) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Некорректное изображение');
  return skins.save(name, Buffer.from(m[1], 'base64'), variant, { replace: !!replace });
});
handle('skins:delete', (name) => skins.remove(name));
handle('skins:variant', (name, variant) => skins.setVariant(name, variant));
handle('skins:apply', async (name) => {
  const stored = settings.getAccount();
  if (!stored) throw new Error('Сначала добавьте аккаунт.');
  if (stored.type !== 'microsoft') throw new Error('Скины на сервер Mojang загружаются только с аккаунта Microsoft.');
  const acc = await auth.ensureFresh(stored, settings.getPublic().msClientId);
  settings.saveAccount(acc, false);
  await skins.upload(name, acc.mcToken);
});

// ---------- моды (Modrinth) ----------
const mods = require('./src/mods');
let modsAbort = null;
handle('mods:search', (o) => mods.search(o || {}));
handle('mods:project', (o) => mods.project(o || {}));
handle('mods:plan', (o) => mods.plan(o || {}));
handle('mods:installed', (o) => mods.list(o || {}));
handle('mods:remove', (o) => mods.remove(o || {}));
handle('mods:updates', (o) => mods.updates(o || {}));
handle('mods:cancel', () => { if (modsAbort) modsAbort.abort(); });
handle('mods:install', async (o) => {
  if (modsAbort) throw new Error('Установка мода уже идёт');
  modsAbort = new AbortController();
  try {
    return await mods.install(o || {}, { signal: modsAbort.signal, onProgress: (p) => send('mods:progress', p) });
  } finally {
    modsAbort = null;
  }
});

// ---------- Medieval Fantasy (отдельное направление) ----------
const mf = require('./src/mf');
let mfAbort = null;
const mfProgress = (p) => send('mf:progress', p);
handle('mf:status', () => mf.status());
handle('mf:getSettings', () => ({ settings: mf.getSettings(), presets: mf.PRESETS }));
handle('mf:setSettings', (patch) => mf.setSettings(patch || {}));
handle('mf:applyPreset', (id) => mf.applyPreset(id));
handle('mf:worlds', () => mf.worlds());
handle('mf:shaders', () => mf.shaders());
handle('mf:setShader', (name) => mf.setSettings({ shader: name || null }));
handle('mf:cancel', () => { if (mfAbort) mfAbort.abort(); });
handle('mf:openFolder', async (which) => {
  const sub = { saves: 'saves', shaders: 'shaderpacks', resourcepacks: 'resourcepacks', mods: 'mods' }[which] || '';
  const dir = path.join(P.mf, sub);
  fs.mkdirSync(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
});
handle('mf:installExtra', async (o) => {
  if (mfAbort) throw new Error('Уже идёт загрузка');
  mfAbort = new AbortController();
  try { return await mf.installExtra(o || {}, { signal: mfAbort.signal, onProgress: mfProgress }); }
  finally { mfAbort = null; }
});
handle('mf:updates', () => mf.checkUpdates());
handle('mf:update', async () => {
  if (mfAbort) throw new Error('Уже идёт загрузка');
  mfAbort = new AbortController();
  try { return await mf.updateAll({ signal: mfAbort.signal, onProgress: mfProgress }); }
  finally { mfAbort = null; }
});
handle('mf:install', async () => {
  if (state !== 'idle') throw new Error('Лаунчер уже занят');
  setState('installing');
  mfAbort = new AbortController();
  try {
    return await mf.installPack({ installer, loaders, javaMod, javaSetting: settings.getPublic().javaPath }, { signal: mfAbort.signal, onProgress: mfProgress });
  } finally {
    mfAbort = null;
    setState('idle');
  }
});
handle('mf:play', async ({ world } = {}) => {
  if (state !== 'idle') throw new Error('Лаунчер уже занят');
  const st = mf.status();
  if (!st.installed) throw new Error('Сборка Medieval Fantasy ещё не установлена.');
  setState('installing');
  try {
    const s = settings.getPublic();
    const stored = settings.getAccount();
    if (!stored) throw new Error('Сначала добавьте аккаунт (кнопка «Аккаунт»)');
    const ms = mf.getSettings();
    mfProgress({ text: 'Подготовка…', percent: null });
    await installer.installVanilla(mf.MC, () => {}, P.mf);
    const javaPath = await javaMod.ensureJava(javaMod.requiredMajor(V.loadResolved(mf.MC)), s.javaPath, (pct, t) => mfProgress({ text: t || '', percent: null }));
    mfProgress({ text: 'Проверка файлов Forge…', percent: null });
    const forgeId = await loaders.ensureForge(mf.MC, javaPath, (pct, t) => mfProgress({ text: t || '', percent: null }));
    mf.applyGraphics();
    const acc = await auth.ensureFresh(stored, s.msClientId);
    settings.saveAccount(acc, false);
    mfProgress({ text: 'Запуск игры…', percent: null });
    const target = world && fs.existsSync(path.join(P.mf, 'saves', String(world), 'level.dat')) ? String(world) : null;
    const cmd = launch.build({ id: forgeId, account: acc, ramMb: ms.ramMb, javaPath, gameDir: P.mf, quickPlay: target });

    logBuf.length = 0;
    pushLog(`[launcher] Medieval Fantasy · ${st.forgeId}`);
    pushLog(`[launcher] Java: ${javaPath}`);
    pushLog(`[launcher] Папка сборки: ${P.mf}`);
    userStopped = false;
    const child = spawn(cmd.javaPath, cmd.args, { cwd: cmd.cwd, windowsHide: true });
    gameProc = child;
    const onData = (d) => String(d).split(/\r?\n/).forEach((l) => l && pushLog(l));
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => {
      pushLog('[launcher] Ошибка запуска: ' + e.message);
      send('toast', { type: 'error', text: 'Не удалось запустить Java: ' + e.message, log: true });
      gameProc = null;
      setState('idle');
    });
    child.on('close', (code) => {
      gameProc = null;
      pushLog(`[launcher] Игра завершилась с кодом ${code}`);
      if (win && !win.isDestroyed() && win.isMinimized()) win.restore();
      if (code !== 0 && !userStopped) send('toast', { type: 'error', text: `Игра завершилась с ошибкой (код ${code})`, log: true });
      mfProgress({ text: '', percent: 0 });
      setState('idle');
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    mfProgress({ text: 'Игра запущена', percent: 100 });
    setState('running');
    if (s.hideOnLaunch && win) win.minimize();
  } catch (e) {
    if (state !== 'running') { mfProgress({ text: '', percent: 0 }); setState('idle'); }
    throw e;
  }
});

// ---------- игра ----------
handle('game:state', () => state);
handle('game:log', () => logBuf);
handle('game:stop', () => {
  if (gameProc) { userStopped = true; gameProc.kill(); }
});

handle('game:play', async ({ mc, loader }) => {
  if (state !== 'idle') throw new Error('Лаунчер уже занят');
  if (!V.validId(mc)) throw new Error('Не выбрана версия Minecraft');
  if (!['vanilla', 'fabric', 'forge'].includes(loader)) loader = 'vanilla';

  setState('installing');
  try {
    const s = settings.getPublic();
    const stored = settings.getAccount();
    if (!stored) throw new Error('Сначала добавьте аккаунт (кнопка «Аккаунт»)');

    // У каждой версии и загрузчика своя папка игры: моды, миры и настройки не смешиваются
    const gameDir = P.profileDir(mc, loader);
    fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });

    progress(null, 'Подготовка…');
    await installer.installVanilla(mc, progress, gameDir);

    const baseRes = V.loadResolved(mc);
    const need = javaMod.requiredMajor(baseRes);
    const javaPath = await javaMod.ensureJava(need, s.javaPath, progress);

    let id = mc;
    if (loader === 'fabric') id = await loaders.ensureFabric(mc, progress);
    else if (loader === 'forge') id = await loaders.ensureForge(mc, javaPath, progress);

    progress(null, 'Проверка аккаунта…');
    const acc = await auth.ensureFresh(stored, s.msClientId);
    settings.saveAccount(acc, false);

    progress(null, 'Запуск игры…');
    const cmd = launch.build({ id, account: acc, ramMb: s.ramMb, javaPath, gameDir });

    logBuf.length = 0;
    pushLog(`[launcher] Версия: ${id}`);
    pushLog(`[launcher] Java: ${javaPath}`);
    pushLog(`[launcher] Папка профиля: ${gameDir}`);
    userStopped = false;
    const child = spawn(cmd.javaPath, cmd.args, { cwd: cmd.cwd, windowsHide: true });
    gameProc = child;

    const onData = (d) => String(d).split(/\r?\n/).forEach((l) => l && pushLog(l));
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => {
      pushLog('[launcher] Ошибка запуска: ' + e.message);
      send('toast', { type: 'error', text: 'Не удалось запустить Java: ' + e.message, log: true });
      gameProc = null;
      setState('idle');
    });
    child.on('close', (code) => {
      gameProc = null;
      pushLog(`[launcher] Игра завершилась с кодом ${code}`);
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
      }
      if (code !== 0 && !userStopped) {
        send('toast', { type: 'error', text: `Игра завершилась с ошибкой (код ${code})`, log: true });
      }
      progress(0, '');
      setState('idle');
    });

    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    progress(100, 'Игра запущена');
    setState('running');
    if (s.hideOnLaunch && win) win.minimize();
  } catch (e) {
    if (state !== 'running') {
      progress(0, '');
      setState('idle');
    }
    throw e;
  }
});
