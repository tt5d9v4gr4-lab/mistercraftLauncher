'use strict';
// Тесты ядра лаунчера. Используют локальный HTTP-сервер вместо серверов Mojang.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-test-'));
process.env.MISTERCRAFT_HOME = tmp;
const TEST_PORT = 18765 + Math.floor(Math.random() * 1000);
process.env.MC_RESOURCES_URL = `http://127.0.0.1:${TEST_PORT}/res`; // до require installer
process.env.MODRINTH_API_URL = `http://127.0.0.1:${TEST_PORT}/mr`;

const rules = require('../src/rules');
const { extractZip } = require('../src/zip');
const V = require('../src/versions');
const installer = require('../src/installer');
const launch = require('../src/launch');
const auth = require('../src/auth');
const javaMod = require('../src/java');
const settings = require('../src/settings');
const P = require('../src/paths');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e.stack || e)); process.exitCode = 1; }
};

// --- минимальный zip с одним файлом (для теста распаковки) ---
function makeZip(files) {
  const locals = []; const centrals = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content); const comp = zlib.deflateRawSync(data);
    const nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); centrals.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

(async () => {
  console.log('Правила и утилиты');
  await test('allowed(): правила os/features', () => {
    const win = { name: 'windows', arch: 'x64', version: '10.0.22631' };
    assert.strictEqual(rules.allowed(undefined, win), true);
    assert.strictEqual(rules.allowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }], win), true);
    assert.strictEqual(rules.allowed([{ action: 'allow', os: { name: 'osx' } }], win), false);
    assert.strictEqual(rules.allowed([{ action: 'allow', os: { name: 'windows', arch: 'x86' } }], win), false);
    assert.strictEqual(rules.allowed([{ action: 'allow', os: { name: 'windows', version: '^10\\.' } }], win), true);
    assert.strictEqual(rules.allowed([{ action: 'allow', features: { is_demo_user: true } }], win, {}), false);
  });
  await test('mavenPath()', () => {
    assert.strictEqual(rules.mavenPath('net.fabricmc:fabric-loader:0.16.9'), 'net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar');
    assert.strictEqual(rules.mavenPath('org.lwjgl:lwjgl:3.3.3:natives-windows'), 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar');
  });
  await test('распаковка zip + защита от zip-slip', () => {
    const z = path.join(tmp, 't.zip');
    fs.writeFileSync(z, makeZip({ 'a/b.txt': 'hello', '../evil.txt': 'x', 'META-INF/x': 'm' }));
    const out = path.join(tmp, 'unz');
    extractZip(z, out, (n) => !n.startsWith('META-INF/'));
    assert.strictEqual(fs.readFileSync(path.join(out, 'a', 'b.txt'), 'utf8'), 'hello');
    assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')));
    assert.ok(!fs.existsSync(path.join(out, 'META-INF', 'x')));
  });
  await test('парсинг версии Java', () => {
    assert.strictEqual(javaMod.parseMajor('java version "1.8.0_392"'), 8);
    assert.strictEqual(javaMod.parseMajor('openjdk version "17.0.9" 2023-10-17'), 17);
    assert.strictEqual(javaMod.parseMajor('openjdk version "21" 2023-09-19'), 21);
    assert.strictEqual(javaMod.targetMajor(16), 17);
    assert.ok(javaMod.javaOk(8, 8) && !javaMod.javaOk(17, 8) && javaMod.javaOk(21, 17) && !javaMod.javaOk(8, 17));
  });
  await test('офлайн-аккаунт: UUID и проверка ника', () => {
    assert.strictEqual(auth.offlineUuid('Notch').length, 32);
    assert.strictEqual(auth.offlineUuid('Notch'), auth.offlineUuid('Notch'));
    assert.strictEqual(auth.offlineUuid('Notch').charAt(12), '3');
    assert.throws(() => auth.offlineAccount('a b'));
    assert.strictEqual(auth.offlineAccount('Mister_1').type, 'offline');
  });
  await test('settings: сохранение, шифрование токенов, аккаунты', () => {
    settings.update({ ramMb: 6144, javaPath: 'C:\\j\\java.exe' });
    settings.saveAccount({ id: 'x', type: 'microsoft', name: 'N', uuid: 'u', refreshToken: 'SECRET', mcToken: 'TOK', mcExpires: 1 });
    const raw = fs.readFileSync(P.settings, 'utf8');
    assert.ok(!raw.includes('SECRET') && !raw.includes('"TOK"'));
    settings._reset();
    assert.strictEqual(settings.getPublic().ramMb, 6144);
    assert.strictEqual(settings.getAccount().refreshToken, 'SECRET');
    settings.removeAccount('x');
    assert.strictEqual(settings.listAccounts().accounts.length, 0);
  });

  // ---- интеграционный тест установки с локальным сервером ----
  console.log('Установка и запуск (локальный сервер)');
  const files = {};
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/mr/')) return mrHandler(req, res);
    const f = files[req.url];
    if (!f) { res.statusCode = 404; return res.end('nf'); }
    res.end(f);
  });
  await new Promise((r) => server.listen(TEST_PORT, '127.0.0.1', r));
  const base = `http://127.0.0.1:${TEST_PORT}`;

  const clientJar = Buffer.from('CLIENTJAR');
  const libJar = Buffer.from('LIBJAR');
  const nativeJar = makeZip({ 'lwjgl.dll': 'DLL', 'META-INF/MANIFEST.MF': 'x' });
  const asset = Buffer.from('ASSET1');
  const aHash = sha1(asset);
  const index = Buffer.from(JSON.stringify({ objects: { 'icons/icon.png': { hash: aHash, size: asset.length } } }));
  files['/client.jar'] = clientJar;
  files['/lib.jar'] = libJar;
  files['/native.jar'] = nativeJar;
  files['/index.json'] = index;
  files[`/res/${aHash.slice(0, 2)}/${aHash}`] = asset;

  const vjson = {
    id: '9.9.9', type: 'release', mainClass: 'net.minecraft.client.main.Main',
    javaVersion: { majorVersion: 21 },
    assetIndex: { id: '99', url: base + '/index.json', sha1: sha1(index), size: index.length },
    downloads: { client: { url: base + '/client.jar', sha1: sha1(clientJar), size: clientJar.length } },
    libraries: [
      { name: 'x:lib:1', downloads: { artifact: { path: 'x/lib/1/lib-1.jar', url: base + '/lib.jar', sha1: sha1(libJar), size: libJar.length } } },
      { name: 'x:osx:1', rules: [{ action: 'allow', os: { name: 'osx' } }], downloads: { artifact: { path: 'x/osx/1/osx-1.jar', url: base + '/nope.jar' } } },
      { name: 'x:nat:1', natives: { windows: 'natives-windows' }, extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-windows': { path: 'x/nat/1/nat-1-natives-windows.jar', url: base + '/native.jar', sha1: sha1(nativeJar), size: nativeJar.length } } } },
    ],
    arguments: {
      game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}',
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
        { rules: [{ action: 'allow', features: { is_quick_play_singleplayer: true } }], value: ['--quickPlaySingleplayer', '${quickPlaySingleplayer}'] }],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
  };
  fs.mkdirSync(path.join(P.versions, '9.9.9'), { recursive: true });
  fs.writeFileSync(V.versionJsonPath('9.9.9'), JSON.stringify(vjson));

  await test('installResolved(): jar, библиотеки, ресурсы, natives', async () => {
    const seen = [];
    await installer.installResolved('9.9.9', (p, t) => seen.push(p));
    assert.ok(fs.existsSync(path.join(P.versions, '9.9.9', '9.9.9.jar')));
    assert.ok(fs.existsSync(path.join(P.libraries, 'x/lib/1/lib-1.jar')));
    assert.ok(!fs.existsSync(path.join(P.libraries, 'x/osx/1/osx-1.jar')), 'osx-библиотека не должна скачиваться');
    assert.ok(fs.existsSync(path.join(P.assets, 'objects', aHash.slice(0, 2), aHash)));
    assert.strictEqual(fs.readFileSync(path.join(P.versions, '9.9.9', 'natives', 'lwjgl.dll'), 'utf8'), 'DLL');
    assert.ok(!fs.existsSync(path.join(P.versions, '9.9.9', 'natives', 'META-INF')));
    assert.strictEqual(seen[seen.length - 1], 100);
    assert.ok(V.listInstalled().find((v) => v.id === '9.9.9' && v.ready && v.hasJar));
  });
  await test('повторная установка использует кэш', async () => {
    delete files['/client.jar']; delete files['/lib.jar'];
    await installer.installResolved('9.9.9');
  });
  await test('launch.build(): аргументы запуска', () => {
    const c = launch.build({ id: '9.9.9', account: { name: 'Steve', uuid: 'abc', type: 'offline', mcToken: '0' }, ramMb: 3072, javaPath: 'java.exe' });
    const a = c.args;
    assert.strictEqual(a[0], '-Xmx3072M');
    assert.ok(a.includes('net.minecraft.client.main.Main'));
    assert.ok(!a.includes('--demo'));
    assert.strictEqual(a[a.indexOf('--username') + 1], 'Steve');
    assert.strictEqual(a[a.indexOf('--version') + 1], '9.9.9');
    const cp = a[a.indexOf('-cp') + 1];
    assert.ok(cp.includes('lib-1.jar') && cp.endsWith('9.9.9.jar') && !cp.includes('osx-1.jar') && !cp.includes('natives-windows'));
    assert.ok(a.indexOf('net.minecraft.client.main.Main') > a.indexOf('-cp'));
    assert.ok(!a.some((x) => /\$\{/.test(x)), 'остались неподставленные переменные');
  });
  await test('наследование версий (как Fabric) и старый формат minecraftArguments', () => {
    const fabric = { id: 'fabric-loader-0.1-9.9.9', inheritsFrom: '9.9.9', type: 'release', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
      libraries: [{ name: 'net.fabricmc:fabric-loader:0.1', url: base + '/maven/' }] };
    fs.mkdirSync(path.join(P.versions, fabric.id), { recursive: true });
    fs.writeFileSync(V.versionJsonPath(fabric.id), JSON.stringify(fabric));
    const r = V.loadResolved(fabric.id);
    assert.strictEqual(r.jarId, '9.9.9');
    assert.strictEqual(r.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');
    assert.ok(r.libraries.length === 4 && r.libraries[0].name.startsWith('net.fabricmc'));
    const c = launch.build({ id: fabric.id, account: { name: 'Alex', uuid: 'u', type: 'microsoft', mcToken: 'T' } });
    assert.ok(c.args.some((x) => x.includes('fabric-loader-0.1.jar') || true));
    assert.ok(c.args.join(' ').includes('fabric-loader-0.1.jar'));
    assert.ok(c.args.includes('-DFabricMcEmu= net.minecraft.client.main.Main '));
    // клиентский jar надстройки называется по её id (нужно Forge: -DignoreList=...${version_name}.jar)
    assert.ok(fs.existsSync(path.join(P.versions, fabric.id, fabric.id + '.jar')));
    const fcp = c.args[c.args.indexOf('-cp') + 1];
    assert.ok(fcp.endsWith(fabric.id + '.jar') && !fcp.endsWith(path.sep + '9.9.9.jar'));

    const old = { id: '1.7.10', type: 'release', mainClass: 'net.minecraft.client.main.Main', assets: 'legacy',
      minecraftArguments: '--username ${auth_player_name} --session ${auth_session} --gameDir ${game_directory} --assetsDir ${game_assets}',
      libraries: [{ name: 'a:b:1', downloads: { artifact: { path: 'a/b/1/b-1.jar', url: '' } } }] };
    fs.mkdirSync(path.join(P.versions, '1.7.10'), { recursive: true });
    fs.writeFileSync(V.versionJsonPath('1.7.10'), JSON.stringify(old));
    const o = launch.build({ id: '1.7.10', account: { name: 'Old', uuid: 'u1', type: 'offline' } });
    assert.ok(o.args.includes('-cp') && o.args.includes('--session'));
    assert.strictEqual(o.args[o.args.indexOf('--session') + 1], 'token:0:u1');
    assert.ok(o.args.includes('-Djava.library.path=' + path.join(P.versions, '1.7.10', 'natives')));
  });
  await test('удаление версии и защита пути', () => {
    V.deleteVersion('1.7.10');
    assert.ok(!fs.existsSync(path.join(P.versions, '1.7.10')));
    assert.throws(() => V.deleteVersion('../x'));
    assert.ok(!V.validId('..') && V.validId('1.20.1') && V.validId('fabric-loader-0.16.9-1.21.4'));
  });

  await test('скины: сохранение, проверка размера, список, удаление', () => {
    const skins = require('../src/skins');
    const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
    assert.strictEqual(skins.save('Мой скин', png(64, 64), 'slim'), 'Мой скин');
    assert.throws(() => skins.save('Мой скин', png(64, 64), 'classic'), /уже существует/);
    assert.strictEqual(skins.save('Мой скин', png(64, 32), 'classic', { replace: true }), 'Мой скин');
    assert.throws(() => skins.save('bad', png(128, 128)), /64×64/);
    assert.throws(() => skins.save('../x', png(64, 64)));
    assert.throws(() => skins.save('nopng', Buffer.from('hello world, not a png at all!!')), /PNG/);
    assert.strictEqual(skins.save('Мой скин', png(64, 64), 'slim', { unique: true }), 'Мой скин 2');
    skins.setVariant('Мой скин', 'slim');
    const l = skins.list();
    assert.strictEqual(l.length, 2);
    assert.ok(l.find((x) => x.name === 'Мой скин').variant === 'slim' && l[0].dataUrl.startsWith('data:image/png;base64,'));
    skins.remove('Мой скин'); skins.remove('Мой скин 2');
    assert.strictEqual(skins.list().length, 0);
  });

  await test('download(): проверка sha256 отклоняет повреждённый файл', async () => {
    const { download } = require('../src/http');
    const good = Buffer.from('jre-archive-bytes');
    files['/jre.zip'] = good;
    const dest = path.join(tmp, 'dl', 'jre.zip');
    const h256 = crypto.createHash('sha256').update(good).digest('hex');
    await assert.rejects(() => download(base + '/jre.zip', dest, { sha256: 'a'.repeat(64) }), /контрольная сумма/);
    assert.ok(!fs.existsSync(dest) && !fs.existsSync(dest + '.part'), 'повреждённый файл не должен оставаться');
    await download(base + '/jre.zip', dest, { sha256: h256.toUpperCase() });
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'jre-archive-bytes');
    fs.writeFileSync(dest, 'broken');
    await download(base + '/jre.zip', dest, { sha256: h256 }); // битый кэш перекачивается
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'jre-archive-bytes');
  });

  // ---- поддельный Modrinth ----
  let lastFacets = '';
  const jar = (txt) => Buffer.from(txt);
  const J = { a10: jar('MODA-1.0'), a11: jar('MODA-1.1'), b20: jar('MODB-2.0'), d10: jar('MODD-1.0'), x: jar('EVIL') };
  files['/files/moda-1.0.jar'] = J.a10; files['/files/moda-1.1.jar'] = J.a11;
  files['/files/modb-2.0.jar'] = J.b20; files['/files/modd-1.0.jar'] = J.d10; files['/files/evil.jar'] = J.x;
  const fileObj = (name, buf, dir = 'files') => ({ url: `${base}/${dir}/${name}`, filename: name, primary: true, size: buf.length, hashes: { sha1: sha1(buf) } });
  const ver = (id, pid, num, name, buf, extra = {}) => ({ id, project_id: pid, version_number: num, name: num, version_type: 'release', game_versions: ['1.20.1'], loaders: ['forge'], files: [fileObj(name, buf)], dependencies: [], ...extra });
  const proj = (id, title, extra = {}) => ({ id, slug: title.toLowerCase().replace(/ /g, ''), title, description: title + ' описание', body: '# Hi\n![x](y) text', icon_url: null, gallery: [], downloads: 10, followers: 1, loaders: ['forge'], game_versions: ['1.20.1'], ...extra });
  const mr = {
    projects: {
      AAAAAAAA: proj('AAAAAAAA', 'Mod A'), BBBBBBBB: proj('BBBBBBBB', 'Mod B'), CCCCCCCC: proj('CCCCCCCC', 'Mod C'),
      DDDDDDDD: proj('DDDDDDDD', 'Mod D'), EEEEEEEE: proj('EEEEEEEE', 'Mod E', { loaders: ['fabric'] }), XXXXXXXX: proj('XXXXXXXX', 'Mod X'),
    },
    versions: {
      AAAAAAAA: [
        ver('VA2', 'AAAAAAAA', '1.1', 'moda-1.1.jar', J.a11, { dependencies: [{ project_id: 'BBBBBBBB', version_id: null, dependency_type: 'required' }] }),
        ver('VA1', 'AAAAAAAA', '1.0', 'moda-1.0.jar', J.a10, { dependencies: [{ project_id: 'BBBBBBBB', version_id: null, dependency_type: 'required' }, { project_id: 'CCCCCCCC', version_id: null, dependency_type: 'optional' }] }),
      ],
      BBBBBBBB: [ver('VB1', 'BBBBBBBB', '2.0', 'modb-2.0.jar', J.b20)],
      DDDDDDDD: [ver('VD1', 'DDDDDDDD', '1.0', 'modd-1.0.jar', J.d10)],
      EEEEEEEE: [ver('VE1', 'EEEEEEEE', '3.0', 'mode.jar', J.d10, { game_versions: ['1.20.1'], loaders: ['fabric'] })],
      XXXXXXXX: [{ ...ver('VX1', 'XXXXXXXX', '1', 'evil.jar', J.x), files: [{ ...fileObj('evil.jar', J.x), filename: '../evil.jar' }] }],
    },
  };
  files['/files/cool.zip'] = Buffer.from('SHADERZIP');
  mr.projects.SHADERPR = proj('SHADERPR', 'Cool Shader', { project_type: 'shader', slug: 'cool-shader' });
  mr.versions.SHADERPR = [{ id: 'VS1', project_id: 'SHADERPR', version_number: '1', name: '1', version_type: 'release', game_versions: ['1.20.1'], loaders: ['iris'], files: [fileObj('cool.zip', Buffer.from('SHADERZIP'))], dependencies: [] }];
  function mrHandler(req, res) {
    const u = new URL(req.url, base);
    const p = u.pathname.replace(/^\/mr/, '');
    const json = (o, st = 200) => { res.statusCode = st; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    let m;
    if ((m = /^\/project\/([\w-]+)\/version$/.exec(p))) {
      let l = mr.versions[m[1]] || [];
      const gv = u.searchParams.get('game_versions'); const ld = u.searchParams.get('loaders');
      if (gv) l = l.filter((v) => JSON.parse(gv).some((x) => v.game_versions.includes(x)));
      if (ld) l = l.filter((v) => JSON.parse(ld).some((x) => v.loaders.includes(x)));
      return json(l);
    }
    if (/^\/project\/([\w-]+)\/members$/.test(p)) return json([{ role: 'Owner', user: { username: 'Tester' } }]);
    if ((m = /^\/project\/([\w-]+)$/.exec(p))) { const pr = mr.projects[m[1]] || Object.values(mr.projects).find((x) => x.slug === m[1]); return pr ? json(pr) : json({}, 404); }
    if ((m = /^\/version\/(\w+)$/.exec(p))) {
      const v = Object.values(mr.versions).flat().find((x) => x.id === m[1]);
      return v ? json(v) : json({}, 404);
    }
    if (p === '/projects') return json(JSON.parse(u.searchParams.get('ids')).map((id) => mr.projects[id]).filter(Boolean));
    if (p === '/search') {
      lastFacets = u.searchParams.get('facets');
      return json({ total_hits: 1, hits: [{ project_id: 'AAAAAAAA', slug: 'moda', title: 'Mod A', description: 'd', author: 'Tester', downloads: 10, icon_url: null, display_categories: ['utility'] }] });
    }
    if (p === '/version_files/update' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { hashes } = JSON.parse(body);
        const out = {};
        for (const h of hashes) if (h === sha1(J.a10)) out[h] = mr.versions.AAAAAAAA[0];
        json(out);
      });
      return;
    }
    return json({}, 404);
  }

  await test('моды (Modrinth): план с зависимостями, совместимость, установка, список, обновление, удаление', async () => {
    const mods = require('../src/mods');
    const prof = { mc: '1.20.1', loader: 'forge' };
    const pl = await mods.plan({ ...prof, projectId: 'AAAAAAAA' });
    assert.deepStrictEqual(pl.items.map((i) => i.title), ['Mod B', 'Mod A'], 'зависимость ставится первой');
    assert.ok(pl.items[0].isDep && !pl.items[1].isDep);
    assert.strictEqual(pl.items[1].versionNumber, '1.1', 'берётся новейший релиз');
    const plOld = await mods.plan({ ...prof, projectId: 'AAAAAAAA', versionId: 'VA1' });
    assert.strictEqual(plOld.items[1].versionNumber, '1.0');
    assert.deepStrictEqual(plOld.optional.map((o) => o.title), ['Mod C'], 'необязательная зависимость только предлагается');

    const prog = [];
    const r = await mods.install({ ...prof, projectId: 'AAAAAAAA' }, { onProgress: (x) => prog.push(x.percent) });
    assert.strictEqual(r.installed.length, 2);
    assert.strictEqual(prog[prog.length - 1], 100);
    const dir = path.join(P.profileDir('1.20.1', 'forge'), 'mods');
    assert.ok(fs.existsSync(path.join(dir, 'moda-1.1.jar')) && fs.existsSync(path.join(dir, 'modb-2.0.jar')));

    const l = mods.list(prof);
    assert.strictEqual(l.entries.length, 2);
    assert.deepStrictEqual(l.entries.find((e) => e.projectId === 'BBBBBBBB').requiredBy, ['Mod A']);
    assert.ok(l.entries.find((e) => e.projectId === 'BBBBBBBB').isDep);
    assert.strictEqual(mods.list({ mc: '1.20.1', loader: 'fabric' }).entries.length, 0, 'другой профиль не затронут');
    assert.notStrictEqual(P.profileDir('1.20.1', 'forge'), P.profileDir('1.20.1', 'fabric'));
    assert.notStrictEqual(P.profileDir('1.20.1', 'forge'), P.profileDir('1.21.4', 'forge'));

    assert.strictEqual((await mods.plan({ ...prof, projectId: 'AAAAAAAA' })).items.length, 0, 'уже установлен');
    await assert.rejects(() => mods.plan({ ...prof, projectId: 'EEEEEEEE' }), /нет версии для Forge[^]*Fabric/);
    await assert.rejects(() => mods.plan({ mc: '1.20.1', loader: 'vanilla', projectId: 'AAAAAAAA' }), /Fabric и Forge/);

    fs.writeFileSync(path.join(dir, 'manual.jar'), 'x');
    assert.deepStrictEqual(mods.list(prof).manual.map((m) => m.filename), ['manual.jar']);
    mods.remove({ ...prof, filename: 'manual.jar' });
    assert.ok(!fs.existsSync(path.join(dir, 'manual.jar')));

    // обновление: старая версия заменяется новой
    mods.remove({ ...prof, projectId: 'AAAAAAAA' });
    await mods.install({ ...prof, projectId: 'AAAAAAAA', versionId: 'VA1' });
    assert.ok(fs.existsSync(path.join(dir, 'moda-1.0.jar')));
    const up = await mods.updates(prof);
    assert.deepStrictEqual(up.map((u) => [u.projectId, u.versionNumber]), [['AAAAAAAA', '1.1']]);
    await mods.install({ ...prof, projectId: 'AAAAAAAA', versionId: up[0].versionId });
    assert.ok(fs.existsSync(path.join(dir, 'moda-1.1.jar')) && !fs.existsSync(path.join(dir, 'moda-1.0.jar')));

    mods.remove({ ...prof, projectId: 'AAAAAAAA' });
    assert.ok(!fs.existsSync(path.join(dir, 'moda-1.1.jar')));
    assert.strictEqual(mods.list(prof).entries.length, 1);
  });
  await test('моды: поиск с фильтрами, страница мода, отмена и защита файлов', async () => {
    const mods = require('../src/mods');
    const prof = { mc: '1.20.1', loader: 'forge' };
    const s2 = await mods.search({ ...prof, q: 'a', sort: 'downloads', category: 'utility', onlyCompat: true, offset: 0 });
    assert.strictEqual(s2.hits[0].title, 'Mod A');
    assert.ok(lastFacets.includes('versions:1.20.1') && lastFacets.includes('categories:forge') && lastFacets.includes('categories:utility'));
    await mods.search({ ...prof, q: '', onlyCompat: false });
    assert.ok(!lastFacets.includes('versions:'));
    const pr = await mods.project({ ...prof, projectId: 'AAAAAAAA' });
    assert.ok(pr.compat.ok && pr.compat.versionNumber === '1.1' && pr.author === 'Tester' && !pr.body.includes('!['));
    const bad = await mods.project({ ...prof, projectId: 'EEEEEEEE' });
    assert.ok(!bad.compat.ok && /Fabric/.test(bad.compat.reason));

    const ac = new AbortController(); ac.abort();
    await assert.rejects(() => mods.install({ ...prof, projectId: 'DDDDDDDD' }, { signal: ac.signal }), /отменена/);
    assert.ok(!fs.existsSync(path.join(P.profileDir('1.20.1', 'forge'), 'mods', 'modd-1.0.jar')), 'после отмены файла нет');

    await assert.rejects(() => mods.install({ ...prof, projectId: 'XXXXXXXX' }), /Недопустимое имя файла/);
    assert.throws(() => mods.checkUrl('https://evil.example.com/a.jar'), /не на Modrinth/);
    assert.throws(() => mods.checkUrl('http://cdn.modrinth.com/a.jar'), /не на Modrinth/);
    mods.checkUrl('https://cdn.modrinth.com/data/x/versions/y/a.jar');
    assert.throws(() => mods.safeFile('../x.jar'));
    assert.throws(() => mods.safeFile('a.exe'));
    assert.strictEqual(mods.safeFile('Fabric API 0.9+1.20.1.jar'), 'Fabric API 0.9+1.20.1.jar');
  });

  await test('Medieval Fantasy: только 1.20.1+Forge, изоляция, отчёт, шейдеры, графика, миры, быстрый вход', async () => {
    const mf = require('../src/mf');
    const mods = require('../src/mods');
    // жёсткое требование 1.20.1 + Forge
    await assert.rejects(() => mods.plan({ mc: '1.21.4', loader: 'forge', projectId: 'AAAAAAAA', space: 'mf' }), /1\.20\.1 и Forge/);
    await assert.rejects(() => mods.plan({ mc: '1.20.1', loader: 'fabric', projectId: 'AAAAAAAA', space: 'mf' }), /1\.20\.1 и Forge/);

    const pack = { mods: [
      { slug: 'moda', title: 'Mod A', required: true },
      { slug: 'нет-такого', title: 'Ghost', alternatives: ['modd'] },
      { slug: 'mode', title: 'Mod E (только Fabric)' },
      { slug: 'missing-mod', title: 'Missing' },
    ] };
    const report = await mf.installMods(pack, {});
    assert.deepStrictEqual(report.installed, ['Mod A', 'Mod B (зависимость)', 'Mod D (вместо Ghost)'], 'альтернатива подхватилась, зависимость отмечена');
    assert.deepStrictEqual(report.failed.map((f) => f.title).sort(), ['Missing', 'Mod E (только Fabric)']);
    assert.ok(/Fabric/.test(report.failed.find((f) => f.title.startsWith('Mod E')).reason), 'причина несовместимости объяснена');
    assert.ok(/не найден/.test(report.failed.find((f) => f.title === 'Missing').reason));

    // файлы MF лежат отдельно от обычных профилей
    assert.ok(fs.existsSync(path.join(P.mf, 'mods', 'moda-1.1.jar')) && fs.existsSync(path.join(P.mf, 'mods', 'modd-1.0.jar')));
    assert.ok(!fs.existsSync(path.join(P.profileDir('1.20.1', 'forge'), 'mods', 'modd-1.0.jar')), 'обычный профиль не затронут');
    assert.strictEqual(mods.list({ mc: '1.20.1', loader: 'forge', space: 'mf' }).entries.length, 3);
    assert.ok(mods.list({ mc: '1.20.1', loader: 'forge' }).entries.every((e) => e.projectId !== 'DDDDDDDD'));
    const up = await mf.checkUpdates();
    assert.ok(Array.isArray(up));

    // шейдеры
    const ex = await mf.installExtra({ kind: 'shader', slug: 'cool-shader' });
    assert.strictEqual(ex.filename, 'cool.zip');
    assert.ok(fs.existsSync(path.join(P.mf, 'shaderpacks', 'cool.zip')));
    await assert.rejects(() => mf.installExtra({ kind: 'resourcepack', slug: 'cool-shader' }), /не набор текстур/);
    assert.deepStrictEqual(mf.shaders().installed, ['cool.zip']);
    mf.setSettings({ shader: 'cool.zip' });
    assert.throws(() => mf.setSettings({ shader: 'нет.zip' }), /нет в папке/);

    // графические профили → options.txt и oculus.properties, остальное сохраняется
    fs.writeFileSync(path.join(P.mf, 'options.txt'), 'version:3465\nrenderDistance:12\nlang:ru_ru\n');
    const ap = mf.applyPreset('ultra');
    assert.strictEqual(ap.renderDistance, 32);
    const g = mf.applyGraphics();
    assert.ok(g.shadersOn);
    const opt = fs.readFileSync(path.join(P.mf, 'options.txt'), 'utf8');
    assert.ok(/renderDistance:32/.test(opt) && /lang:ru_ru/.test(opt) && /simulationDistance:16/.test(opt) && /version:3465/.test(opt));
    const oc = fs.readFileSync(path.join(P.mf, 'config', 'oculus.properties'), 'utf8');
    assert.ok(/enableShaders=true/.test(oc) && /shaderPack=cool\.zip/.test(oc));
    mf.applyPreset('light');
    assert.ok(!mf.applyGraphics().shadersOn);
    assert.ok(/enableShaders=false/.test(fs.readFileSync(path.join(P.mf, 'config', 'oculus.properties'), 'utf8')));
    assert.strictEqual(mf.getSettings().ramMb, 4096);

    // миры: сортировка по времени, быстрый вход в мир
    for (const [n, t] of [['Старый', 1000], ['Новый', 2000]]) {
      fs.mkdirSync(path.join(P.mf, 'saves', n), { recursive: true });
      const lv = path.join(P.mf, 'saves', n, 'level.dat'); fs.writeFileSync(lv, 'x'); fs.utimesSync(lv, t, t);
    }
    fs.mkdirSync(path.join(P.mf, 'saves', 'не мир'), { recursive: true });
    assert.deepStrictEqual(mf.worlds().map((w) => w.name), ['Новый', 'Старый']);
    const acc = { name: 'S', uuid: 'u', type: 'offline', mcToken: '0' };
    const qp = launch.build({ id: '9.9.9', account: acc, gameDir: P.mf, quickPlay: 'Новый' });
    assert.strictEqual(qp.args[qp.args.indexOf('--quickPlaySingleplayer') + 1], 'Новый');
    assert.strictEqual(qp.cwd, P.mf);
    assert.ok(!launch.build({ id: '9.9.9', account: acc }).args.includes('--quickPlaySingleplayer'), 'обычный запуск без quickPlay');

    // манифест сборки: корректен, всё для 1.20.1 + Forge
    const pk = mf.loadPack();
    assert.ok(pk.mc === '1.20.1' && pk.loader === 'forge' && pk.mods.length >= 20);
    assert.ok(pk.mods.every((m) => /^[\w\-]{1,64}$/.test(m.slug) && (m.alternatives || []).every((a) => /^[\w\-]{1,64}$/.test(a))));
    // этап 2: манифест без дублей, 2 шейдера, отключённые не ставятся, датапак сюжета
    const slugs = pk.mods.map((m) => m.slug);
    assert.strictEqual(new Set(slugs).size, slugs.length, 'нет дублей модов');
    assert.strictEqual(pk.shaders.length, 2, 'ровно 2 шейдера');
    assert.ok(pk.mods.filter((m) => m.disabled).every((m) => m.reason), 'у отключённых есть причина');
    const rep2 = await mf.installMods({ mods: [{ slug: 'moda', title: 'Mod A' }, { slug: 'x-off', title: 'Off', disabled: true, reason: 'дубль' }] }, {});
    assert.deepStrictEqual(rep2.skipped, [{ title: 'Off', reason: 'дубль' }]);
    assert.strictEqual(rep2.total, 1);
    const st = mf.installStory();
    assert.ok(fs.existsSync(path.join(st.path, 'pack.mcmeta')) && fs.existsSync(path.join(st.path, 'data', 'mf_story', 'advancements', 'root.json')));
    mf.patchKeyFile(path.join(tmp, 'k.txt'), { a: '1', b: null }, '=');
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'k.txt'), 'utf8'), 'a=1\n');
  });

  await test('verifyZip: находит повреждённый jar и неверные имена', async () => {
    const { verifyZip } = require('../src/zip');
    const zlib = require('zlib');
    const mk = (name, data, crcFix) => {
      const raw = zlib.deflateRawSync(data); const { crc32 } = require('../src/zip');
      const nb = Buffer.isBuffer(name) ? name : Buffer.from(name);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(((crc32(data) ^ crcFix) >>> 0), 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
      const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(((crc32(data) ^ crcFix) >>> 0), 16); cd.writeUInt32LE(raw.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nb.length, 28);
      const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(46 + nb.length, 12); eo.writeUInt32LE(30 + nb.length + raw.length, 16);
      return Buffer.concat([lh, nb, raw, cd, nb, eo]);
    };
    const f = path.join(tmp, 'v.zip');
    fs.writeFileSync(f, mk('a.class', Buffer.from('hello world hello world'), 0)); assert.strictEqual(verifyZip(f), null);
    fs.writeFileSync(f, mk('a.class', Buffer.from('hello world hello world'), 1)); assert.ok(/контрольная/.test(verifyZip(f)));
    fs.writeFileSync(f, mk(Buffer.from([0x61, 0xff, 0xfe]), Buffer.from('x'), 0)); assert.ok(/повреждён/.test(verifyZip(f)));
  });

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nПройдено тестов: ${passed}${process.exitCode ? ' (есть ошибки)' : ''}`);
})();
