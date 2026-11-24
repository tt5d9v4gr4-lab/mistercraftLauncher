'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
}

async function call(ch, ...args) {
  const r = await window.api.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const TYPE_TABS = {
  release: ['release'],
  snapshot: ['snapshot'],
  old: ['old_beta', 'old_alpha'],
};
const LOADER_NAME = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge' };

const S = {
  settings: null,
  info: null,
  manifest: null,
  installed: [],
  tab: 'release',
  query: '',
  selected: { mc: null, loader: 'vanilla' },
  support: {},
  state: 'idle',
  accounts: [],
  active: null,
  msUrl: null,
};

/* ---------- уведомления ---------- */
function toast(text, type = 'info', withLog = false) {
  const t = h('div', { class: 'toast ' + type }, h('div', { class: 't', text }));
  if (withLog) t.append(h('button', { text: 'Журнал', onclick: () => { openModal('m-log'); t.remove(); } }));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), withLog ? 14000 : 7000);
}
const fail = (e) => toast(e && e.message ? e.message : String(e), 'error');

/* ---------- модальные окна ---------- */
function openModal(id) {
  if (id === 'm-settings') renderSettings();
  if (id === 'm-account') renderAccounts();
  if (id === 'm-installed') renderInstalled();
  if (id === 'm-log') renderLog();
  if (id === 'm-skins') renderSkins();
  if (id === 'm-mods') renderMods();
  $('#' + id).classList.add('open');
}
function closeModals() {
  $$('.modal.open').forEach((m) => m.classList.remove('open'));
  if (typeof mfRefresh === 'function' && !$('#mf').classList.contains('hidden')) mfRefresh();
}

/* ---------- аватар ---------- */
function drawAvatar(canvas, name) {
  const c = canvas.getContext('2d');
  const s = canvas.width;
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#111';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#ffcc00';
  c.fillRect(1, 1, s - 2, s - 2);
  c.fillStyle = '#0a0a0a';
  c.fillRect(3, 3, s - 6, s - 6);
  c.fillStyle = '#ffcc00';
  c.font = `bold ${Math.round(s * 0.6)}px Bahnschrift, Segoe UI, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText((name || '?').slice(0, 1).toUpperCase(), s / 2, s / 2 + 1);
}

/* ---------- версии ---------- */
function isInstalled(mc, loader) {
  if (loader === 'vanilla') return S.installed.some((v) => v.id === mc);
  return S.installed.some((v) => v.loader === loader && v.mc === mc);
}

function renderVersions() {
  const list = $('#vlist');
  list.textContent = '';
  if (!S.manifest) {
    list.append(h('div', { class: 'empty' }, 'Список версий не загружен.', h('br'), h('button', { class: 'btn ghost small', style: 'margin-top:10px', text: 'Повторить', onclick: loadManifest })));
    return;
  }
  const types = TYPE_TABS[S.tab];
  const q = S.query.trim().toLowerCase();
  const items = S.manifest.versions.filter((v) => types.includes(v.type) && (!q || v.id.toLowerCase().includes(q)));
  if (!items.length) { list.append(h('div', { class: 'empty', text: 'Ничего не найдено' })); return; }
  const frag = document.createDocumentFragment();
  for (const v of items) {
    const row = h('div', { class: 'vitem' + (v.id === S.selected.mc ? ' sel' : ''), 'data-id': v.id },
      h('span', { class: 'id', text: v.id }),
      isInstalled(v.id, 'vanilla') ? h('span', { class: 'badge', text: 'установлена' }) : null,
      h('span', { class: 'date', text: new Date(v.releaseTime).toLocaleDateString('ru-RU') })
    );
    row.addEventListener('click', () => selectVersion(v.id));
    frag.append(row);
  }
  list.append(frag);
}

async function selectVersion(id) {
  S.selected.mc = id;
  saveSelected();
  renderVersions();
  renderSelected();
  await refreshSupport(id);
}

function saveSelected() {
  call('settings:set', { selected: S.selected }).catch(() => {});
}

async function refreshSupport(mc) {
  if (!mc) return;
  if (!S.support[mc]) {
    try { S.support[mc] = await call('loaders:support', mc); } catch { S.support[mc] = { fabric: null, forge: null }; }
  }
  if (S.selected.mc !== mc) return;
  const sup = S.support[mc];
  for (const b of $$('#loader-chips button')) {
    const l = b.dataset.loader;
    b.disabled = l !== 'vanilla' && sup[l] === false;
  }
  if (S.selected.loader !== 'vanilla' && sup[S.selected.loader] === false) {
    S.selected.loader = 'vanilla';
    saveSelected();
  }
  renderLoaders();
  renderSelected();
}

function renderLoaders() {
  for (const b of $$('#loader-chips button')) b.classList.toggle('active', b.dataset.loader === S.selected.loader);
}

function renderSelected() {
  const { mc, loader } = S.selected;
  $('#hero-ver').textContent = mc ? 'Minecraft ' + mc : 'Версия не выбрана';
  $('#hero-loader').textContent = loader === 'vanilla' ? '' : LOADER_NAME[loader];
  $('#hero-status').textContent = !mc ? '' : isInstalled(mc, loader) ? 'Установлена · готова к запуску' : 'Будет загружена при запуске';
  renderPlay();
}

function renderPlay() {
  const btn = $('#btn-play');
  const lbl = $('#play-label');
  const busy = S.state !== 'idle';
  btn.disabled = busy || !S.selected.mc;
  lbl.textContent = S.state === 'installing' ? 'УСТАНОВКА…' : S.state === 'running' ? 'ИГРА ЗАПУЩЕНА' : 'ИГРАТЬ';
  $('#btn-stop').classList.toggle('hidden', S.state !== 'running');
}

/* ---------- аккаунты ---------- */
function applyAccounts(d) {
  S.accounts = d.accounts;
  S.active = d.active;
  const a = S.accounts.find((x) => x.id === S.active);
  $('#acc-name').textContent = a ? a.name : 'Нет аккаунта';
  $('#acc-type').textContent = a ? (a.type === 'microsoft' ? 'Microsoft' : 'Офлайн') : 'Нажмите, чтобы войти';
  drawAvatar($('#acc-avatar'), a ? a.name : '?');
  if ($('#m-account').classList.contains('open')) renderAccounts();
}

function renderAccounts() {
  const list = $('#acc-list');
  list.textContent = '';
  if (!S.accounts.length) list.append(h('div', { class: 'hint', text: 'Аккаунтов пока нет. Войдите через Microsoft или добавьте офлайн-профиль.' }));
  for (const a of S.accounts) {
    const cv = h('canvas', { width: 30, height: 30 });
    drawAvatar(cv, a.name);
    list.append(h('div', { class: 'acc-row' + (a.id === S.active ? ' active' : '') },
      cv,
      h('span', { class: 'nm', text: a.name }),
      h('span', { class: 'badge', text: a.type === 'microsoft' ? 'Microsoft' : 'Офлайн' }),
      a.id === S.active ? h('span', { class: 'badge', text: 'выбран' }) : h('button', { class: 'btn ghost small', text: 'Выбрать', onclick: () => call('accounts:select', a.id).then(applyAccounts).catch(fail) }),
      h('button', { class: 'btn danger small', text: 'Удалить', onclick: () => call('accounts:remove', a.id).then(applyAccounts).catch(fail) })
    ));
  }
  $('#ms-client-id').value = S.settings.msClientId || '';
}

async function startMicrosoft() {
  const cid = $('#ms-client-id').value.trim();
  if (!cid) { toast('Укажите Azure Client ID (инструкция в README).', 'error'); return; }
  S.settings = await call('settings:set', { msClientId: cid });
  $('#btn-ms').disabled = true;
  try {
    const d = await call('auth:microsoft');
    applyAccounts(d);
    toast('Вход выполнен');
  } catch (e) {
    fail(e);
  } finally {
    $('#btn-ms').disabled = false;
    $('#ms-box').classList.add('hidden');
  }
}

async function addOffline() {
  try {
    applyAccounts(await call('accounts:addOffline', $('#off-name').value));
    $('#off-name').value = '';
  } catch (e) { fail(e); }
}

/* ---------- установленные ---------- */
async function reloadInstalled() {
  try { S.installed = await call('versions:installed'); } catch { S.installed = []; }
  renderSelected();
  renderVersions();
  if ($('#m-installed').classList.contains('open')) renderInstalled();
}

function renderInstalled() {
  const list = $('#inst-list');
  list.textContent = '';
  if (!S.installed.length) { list.append(h('div', { class: 'hint', text: 'Установленных версий пока нет.' })); return; }
  for (const v of S.installed.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) {
    list.append(h('div', { class: 'inst-row' },
      h('span', { class: 'nm', text: v.id }),
      v.loader !== 'vanilla' ? h('span', { class: 'badge', text: LOADER_NAME[v.loader] || v.loader }) : null,
      h('span', { class: 'badge', text: v.type }),
      h('button', {
        class: 'btn danger small', text: 'Удалить', disabled: S.state !== 'idle',
        onclick: async () => {
          if (!confirm(`Удалить версию ${v.id}?\nСохранения и моды не затрагиваются.`)) return;
          try { await call('versions:delete', v.id); await reloadInstalled(); } catch (e) { fail(e); }
        },
      })
    ));
  }
}

/* ---------- настройки ---------- */
async function renderSettings() {
  const total = S.info.totalMb;
  const max = Math.max(2048, Math.floor((total * 0.75) / 512) * 512);
  const r = $('#ram-range');
  r.max = max;
  r.value = Math.min(S.settings.ramMb, max);
  $('#ram-label').textContent = (r.value / 1024).toFixed(1) + ' ГБ';
  $('#chk-hide').checked = !!S.settings.hideOnLaunch;
  $('#root-path').textContent = 'Папка данных: ' + S.info.root;

  const sel = $('#java-select');
  sel.textContent = '';
  sel.append(h('option', { value: 'auto', text: 'Авто (подобрать / скачать)' }));
  if (S.settings.javaPath !== 'auto') sel.append(h('option', { value: S.settings.javaPath, text: S.settings.javaPath }));
  try {
    for (const j of await call('java:list')) {
      if (j.path !== S.settings.javaPath) sel.append(h('option', { value: j.path, text: `Java ${j.major} — ${j.path}` }));
    }
  } catch {}
  sel.value = S.settings.javaPath;
}

/* ---------- журнал ---------- */
async function renderLog() {
  const pre = $('#log-pre');
  try { pre.textContent = (await call('game:log')).join('\n'); } catch { pre.textContent = ''; }
  pre.scrollTop = pre.scrollHeight;
}

/* ---------- загрузка данных ---------- */
async function loadManifest() {
  try {
    S.manifest = await call('versions:manifest');
    if (S.manifest.offline) toast('Нет подключения: показан сохранённый список версий.');
    if (!S.selected.mc) S.selected.mc = S.manifest.latest.release;
  } catch (e) {
    S.manifest = null;
    fail(e);
  }
  renderVersions();
  renderSelected();
  refreshSupport(S.selected.mc);
}

async function play() {
  if (!S.active) { toast('Сначала добавьте аккаунт.', 'error'); openModal('m-account'); return; }
  try {
    await call('game:play', { mc: S.selected.mc, loader: S.selected.loader });
  } catch (e) {
    fail(e);
  } finally {
    reloadInstalled();
  }
}

/* ---------- события ---------- */
function bind() {
  $('#btn-min').onclick = () => call('win:min');
  $('#btn-max').onclick = () => call('win:max');
  $('#btn-close').onclick = () => call('win:close');

  $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
    S.tab = b.dataset.tab;
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    renderVersions();
  }));
  $('#search').addEventListener('input', (e) => { S.query = e.target.value; renderVersions(); });
  $$('#loader-chips button').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    S.selected.loader = b.dataset.loader;
    saveSelected();
    renderLoaders();
    renderSelected();
  }));

  $('#btn-play').onclick = play;
  $('#btn-stop').onclick = () => call('game:stop').catch(fail);
  $('#btn-settings').onclick = () => openModal('m-settings');
  $('#btn-account').onclick = () => openModal('m-account');
  $('#btn-installed').onclick = () => openModal('m-installed');
  $('#btn-open-folder').onclick = () => call('folder:open').catch(fail);
  $('#btn-open-mods').onclick = () => call('folder:open', 'mods', { mc: S.selected.mc, loader: S.selected.loader }).catch(fail);
  $('#btn-open-folder2').onclick = () => call('folder:open').catch(fail);

  $$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) closeModals(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  // Настройки
  $('#ram-range').addEventListener('input', (e) => { $('#ram-label').textContent = (e.target.value / 1024).toFixed(1) + ' ГБ'; });
  $('#ram-range').addEventListener('change', async (e) => { S.settings = await call('settings:set', { ramMb: Number(e.target.value) }); });
  $('#chk-hide').addEventListener('change', async (e) => { S.settings = await call('settings:set', { hideOnLaunch: e.target.checked }); });
  $('#java-select').addEventListener('change', async (e) => { S.settings = await call('settings:set', { javaPath: e.target.value }); });
  $('#java-browse').onclick = async () => {
    try {
      const p = await call('java:browse');
      if (p) { S.settings = await call('settings:set', { javaPath: p }); renderSettings(); }
    } catch (e) { fail(e); }
  };

  // Аккаунты
  $('#btn-ms').onclick = startMicrosoft;
  $('#btn-off-add').onclick = addOffline;
  $('#off-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addOffline(); });
  $('#ms-open').onclick = () => S.msUrl && call('link:open', S.msUrl).catch(fail);
  $('#ms-copy').onclick = () => navigator.clipboard.writeText($('#ms-code').textContent).then(() => toast('Код скопирован'));
  $('#ms-cancel').onclick = () => { call('auth:cancel'); $('#ms-box').classList.add('hidden'); };

  // События от main
  window.api.on('progress', ({ percent, text }) => {
    const fill = $('#bar-fill');
    $('#status-text').textContent = text || (S.state === 'running' ? 'Игра запущена' : 'Готов к запуску');
    $('#status-pct').textContent = percent != null && percent > 0 ? percent + '%' : '';
    if (percent == null && S.state === 'installing') {
      fill.classList.add('indet');
    } else {
      fill.classList.remove('indet');
      fill.style.width = (percent || 0) + '%';
    }
  });
  window.api.on('state', (s) => {
    S.state = s;
    renderPlay();
    if (s === 'idle') {
      $('#bar-fill').classList.remove('indet');
      $('#bar-fill').style.width = '0%';
      $('#status-text').textContent = 'Готов к запуску';
      $('#status-pct').textContent = '';
      reloadInstalled();
    }
  });
  window.api.on('log', (line) => {
    if ($('#m-log').classList.contains('open')) {
      const pre = $('#log-pre');
      pre.append(line + '\n');
      pre.scrollTop = pre.scrollHeight;
    }
  });
  window.api.on('auth:code', ({ userCode, url }) => {
    S.msUrl = url;
    $('#ms-code').textContent = userCode;
    $('#ms-box').classList.remove('hidden');
    if (url) call('link:open', url).catch(() => {});
  });
  window.api.on('toast', ({ type, text, log }) => toast(text, type, log));
}

async function init() {
  bind();
  bindSkins();
  bindMods();
  bindMf();
  try {
    S.info = await call('app:info');
    S.settings = await call('settings:get');
    S.selected = { ...S.settings.selected };
    applyAccounts(await call('accounts:list'));
    S.state = await call('game:state');
    renderPlay();
    await reloadInstalled();
  } catch (e) {
    fail(e);
  }
  renderLoaders();
  await loadManifest();
}

/* ---------- скины ---------- */
const SWATCHES = ['#000000', '#ffffff', '#ffcc00', '#ff9d00', '#e0ac69', '#c68642', '#8d5524', '#3a2a1a', '#ff5252', '#3b5bdb', '#2f9e44', '#00a8a8', '#9c36b5', '#868e96'];
const E = { cv: null, tool: 'pencil', color: '#ffcc00', undo: [], editing: null, drawing: false, last: null };
const edCtx = () => E.cv.getContext('2d', { willReadFrequently: true });

/** Рисует вид спереди (16×32 клеток) из текстуры скина. */
function drawFront(ctx, src, scale, slim, legacy) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 16 * scale, 32 * scale);
  const aw = slim ? 3 : 4;
  const blit = (sx, sy, w, h, dx, dy) => ctx.drawImage(src, sx, sy, w, h, dx * scale, dy * scale, w * scale, h * scale);
  blit(8, 8, 8, 8, 4, 0);
  blit(20, 20, 8, 12, 4, 8);
  blit(44, 20, aw, 12, slim ? 1 : 0, 8);
  blit(legacy ? 44 : 36, legacy ? 20 : 52, aw, 12, 12, 8);
  blit(4, 20, 4, 12, 4, 20);
  blit(legacy ? 4 : 20, legacy ? 20 : 52, 4, 12, 8, 20);
  blit(40, 8, 8, 8, 4, 0);
  if (!legacy) {
    blit(20, 36, 8, 12, 4, 8);
    blit(44, 36, aw, 12, slim ? 1 : 0, 8);
    blit(52, 52, aw, 12, 12, 8);
    blit(4, 36, 4, 12, 4, 20);
    blit(4, 52, 4, 12, 8, 20);
  }
}

async function renderSkins() {
  const grid = $('#skin-grid');
  const acc = S.accounts.find((x) => x.id === S.active);
  const ms = !!acc && acc.type === 'microsoft';
  $('#skin-hint').textContent = ms
    ? 'Нажмите «Применить», и скин загрузится на ваш аккаунт Minecraft. Он появится в игре при следующем запуске.'
    : 'Чтобы скин отображался в игре, нужен аккаунт Microsoft: офлайн-профили скины не поддерживают. Создавать и хранить скины здесь можно и без него.';
  try { S.skins = await call('skins:list'); } catch (e) { fail(e); S.skins = []; }
  grid.textContent = '';
  if (!S.skins.length) { grid.append(h('div', { class: 'empty', text: 'Скинов пока нет. Загрузите PNG или создайте свой.' })); return; }
  for (const sk of S.skins) {
    const cv = h('canvas', { width: 80, height: 160, class: 'skin-prev' });
    const img = new Image();
    img.onload = () => drawFront(cv.getContext('2d'), img, 5, sk.variant === 'slim', img.height === 32);
    img.src = sk.dataUrl;
    const sel = h('select', { class: 'input' }, h('option', { value: 'classic', text: 'Обычный (Steve)' }), h('option', { value: 'slim', text: 'Тонкий (Alex)' }));
    sel.value = sk.variant;
    sel.addEventListener('change', () => call('skins:variant', sk.name, sel.value).then(renderSkins).catch(fail));
    grid.append(h('div', { class: 'skin-card' },
      cv,
      h('div', { class: 'sk-name', text: sk.name }),
      sel,
      h('button', {
        class: 'btn play small', text: 'Применить', disabled: !ms, title: ms ? '' : 'Нужен аккаунт Microsoft',
        onclick: async (ev) => {
          const b = ev.currentTarget;
          b.disabled = true;
          try { await call('skins:apply', sk.name); toast('Скин применён. Он появится в игре при следующем запуске.'); }
          catch (e) { fail(e); }
          finally { b.disabled = !ms; }
        },
      }),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', text: 'Изменить', onclick: () => openEditor(sk) }),
        h('button', {
          class: 'btn danger small', text: 'Удалить',
          onclick: async () => {
            if (!confirm(`Удалить скин «${sk.name}»?`)) return;
            try { await call('skins:delete', sk.name); renderSkins(); } catch (e) { fail(e); }
          },
        })
      )
    ));
  }
}

function drawPreview() {
  const pc = $('#ed-preview').getContext('2d');
  drawFront(pc, E.cv, 5, $('#ed-variant').value === 'slim', false);
}

function applyTemplate() {
  const c = edCtx();
  c.clearRect(0, 0, 64, 64);
  const R = (col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const SKIN = '#e0ac69', SHIRT = '#ffcc00', PANTS = '#2b2b2b', HAIR = '#3a2a1a';
  R(SKIN, 0, 0, 32, 16);
  R(HAIR, 8, 0, 16, 8);
  R(HAIR, 0, 8, 32, 2);
  R(SKIN, 40, 16, 16, 16);
  R(SKIN, 32, 48, 16, 16);
  R(SHIRT, 16, 16, 24, 16);
  R(SHIRT, 44, 20, 4, 4);
  R(SHIRT, 36, 52, 4, 4);
  R(PANTS, 0, 16, 16, 16);
  R(PANTS, 16, 48, 16, 16);
  R('#ffffff', 9, 12, 2, 1); R('#3b5bdb', 10, 12, 1, 1);
  R('#ffffff', 13, 12, 2, 1); R('#3b5bdb', 13, 12, 1, 1);
  R('#8b4a2b', 11, 14, 2, 1);
}

function openEditor(sk) {
  E.editing = sk ? sk.name : null;
  $('#ed-name').value = sk ? sk.name : 'Мой скин';
  $('#ed-variant').value = sk ? sk.variant : 'classic';
  E.undo = [];
  const c = edCtx();
  c.clearRect(0, 0, 64, 64);
  if (sk) {
    const img = new Image();
    img.onload = () => {
      c.drawImage(img, 0, 0);
      if (img.height === 32) { // старый формат: левые части копируем с правых
        c.drawImage(E.cv, 40, 16, 16, 16, 32, 48, 16, 16);
        c.drawImage(E.cv, 0, 16, 16, 16, 16, 48, 16, 16);
      }
      drawPreview();
    };
    img.src = sk.dataUrl;
  } else {
    applyTemplate();
  }
  drawPreview();
  $('#m-editor').classList.add('open');
}

function pushUndo() {
  E.undo.push(edCtx().getImageData(0, 0, 64, 64));
  if (E.undo.length > 40) E.undo.shift();
}

function floodFill(x, y, hex) {
  const c = edCtx();
  const img = c.getImageData(0, 0, 64, 64);
  const d = img.data;
  const idx = (px, py) => (py * 64 + px) * 4;
  const i0 = idx(x, y);
  const t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const n = parseInt(hex.slice(1), 16);
  const f = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  if (t.every((v, k) => v === f[k])) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop();
    if (px < 0 || py < 0 || px > 63 || py > 63) continue;
    const i = idx(px, py);
    if (d[i] !== t[0] || d[i + 1] !== t[1] || d[i + 2] !== t[2] || d[i + 3] !== t[3]) continue;
    d[i] = f[0]; d[i + 1] = f[1]; d[i + 2] = f[2]; d[i + 3] = 255;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  c.putImageData(img, 0, 0);
}

function pixelAt(e) {
  const r = E.cv.getBoundingClientRect();
  return [
    Math.max(0, Math.min(63, Math.floor(((e.clientX - r.left) * 64) / r.width))),
    Math.max(0, Math.min(63, Math.floor(((e.clientY - r.top) * 64) / r.height))),
  ];
}

function stamp(x, y) {
  const c = edCtx();
  if (E.tool === 'eraser') c.clearRect(x, y, 1, 1);
  else { c.fillStyle = E.color; c.fillRect(x, y, 1, 1); }
}

function paintTo(x, y) {
  const [lx, ly] = E.last || [x, y];
  const steps = Math.max(Math.abs(x - lx), Math.abs(y - ly), 1);
  for (let i = 1; i <= steps; i++) stamp(Math.round(lx + ((x - lx) * i) / steps), Math.round(ly + ((y - ly) * i) / steps));
  E.last = [x, y];
}

function undo() {
  const prev = E.undo.pop();
  if (prev) { edCtx().putImageData(prev, 0, 0); drawPreview(); }
}

async function saveSkin() {
  try {
    const name = $('#ed-name').value.trim();
    const saved = await call('skins:save', {
      name,
      dataUrl: E.cv.toDataURL('image/png'),
      variant: $('#ed-variant').value,
      replace: E.editing === name,
    });
    toast(`Скин «${saved}» сохранён`);
    $('#m-editor').classList.remove('open');
    if ($('#m-skins').classList.contains('open')) renderSkins();
  } catch (e) { fail(e); }
}

function bindSkins() {
  E.cv = $('#ed-canvas');
  $('#btn-skins').onclick = () => openModal('m-skins');
  $('#skin-import').onclick = async () => {
    try {
      const n = await call('skins:import');
      if (n) { toast(`Скин «${n}» добавлен`); renderSkins(); }
    } catch (e) { fail(e); }
  };
  $('#skin-new').onclick = () => openEditor(null);

  const sw = $('#ed-swatches');
  for (const col of SWATCHES) {
    sw.append(h('button', { style: `background:${col}`, title: col, onclick: () => { E.color = col; $('#ed-color').value = col; } }));
  }
  $('#ed-color').addEventListener('input', (e) => { E.color = e.target.value; });
  $$('#ed-tools button').forEach((b) => b.addEventListener('click', () => {
    E.tool = b.dataset.tool;
    $$('#ed-tools button').forEach((x) => x.classList.toggle('active', x === b));
  }));

  E.cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    E.cv.setPointerCapture(e.pointerId);
    const [x, y] = pixelAt(e);
    if (E.tool === 'pick') {
      const p = edCtx().getImageData(x, y, 1, 1).data;
      if (p[3] > 0) {
        const hex = '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        E.color = hex; $('#ed-color').value = hex;
      }
      return;
    }
    pushUndo();
    if (E.tool === 'fill') { floodFill(x, y, E.color); drawPreview(); return; }
    E.drawing = true; E.last = null;
    paintTo(x, y);
    drawPreview();
  });
  E.cv.addEventListener('pointermove', (e) => {
    if (!E.drawing) return;
    const [x, y] = pixelAt(e);
    paintTo(x, y);
    drawPreview();
  });
  const stop = () => { E.drawing = false; E.last = null; };
  E.cv.addEventListener('pointerup', stop);
  E.cv.addEventListener('pointercancel', stop);

  $('#ed-variant').addEventListener('change', drawPreview);
  $('#ed-undo').onclick = undo;
  $('#ed-template').onclick = () => { pushUndo(); applyTemplate(); drawPreview(); };
  $('#ed-clear').onclick = () => { pushUndo(); edCtx().clearRect(0, 0, 64, 64); drawPreview(); };
  $('#ed-save').onclick = saveSkin;
  document.addEventListener('keydown', (e) => {
    if ($('#m-editor').classList.contains('open') && e.ctrlKey && e.key.toLowerCase() === 'z' && !/INPUT|SELECT/.test(e.target.tagName)) undo();
  });
}

/* ---------- моды ---------- */
const MOD_CATS = [['', 'Все категории'], ['adventure', 'Приключения'], ['decoration', 'Декор'], ['economy', 'Экономика'], ['equipment', 'Снаряжение'], ['food', 'Еда'], ['game-mechanics', 'Механики'], ['library', 'Библиотеки'], ['magic', 'Магия'], ['management', 'Управление'], ['minigame', 'Миниигры'], ['mobs', 'Мобы'], ['optimization', 'Оптимизация'], ['social', 'Социальные'], ['storage', 'Хранилище'], ['technology', 'Технологии'], ['transportation', 'Транспорт'], ['utility', 'Утилиты'], ['worldgen', 'Генерация мира']];
const MOD_SORTS = [['downloads', 'Популярные'], ['newest', 'Новые'], ['updated', 'Недавно обновлённые'], ['relevance', 'По релевантности']];
const M = { space: null, tab: 'catalog', q: '', sort: 'downloads', sortTouched: false, cat: '', compat: true, offset: 0, total: 0, hits: [], loading: false, busy: false, token: 0, detail: null, inst: { entries: [], manual: [] }, updates: {}, timer: null };

const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0));
const modProfile = () => (M.space === 'mf' ? { mc: '1.20.1', loader: 'forge', space: 'mf' } : { mc: S.selected.mc, loader: S.selected.loader });
const modsReady = () => M.space === 'mf' || (!!S.selected.mc && S.selected.loader !== 'vanilla');

function modIcon(url, title) {
  if (url) return h('img', { class: 'm-icon', src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  return h('div', { class: 'm-icon ph', text: (title || '?').slice(0, 1).toUpperCase() });
}

function openMods(space) {
  M.space = space;
  M.hits = []; M.detail = null; M.updates = {}; M.tab = 'catalog';
  openModal('m-mods');
}

function showModsPane() {
  const ok = modsReady();
  $('#mods-catalog').classList.toggle('hidden', !ok || M.tab !== 'catalog' || !!M.detail);
  $('#mods-detail').classList.toggle('hidden', !ok || !M.detail);
  $('#mods-installed').classList.toggle('hidden', !ok || M.tab !== 'installed');
  $$('#mods-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mtab === M.tab));
}

async function renderMods() {
  const ok = modsReady();
  $('#mods-profile').textContent = M.space === 'mf' ? 'Medieval Fantasy · 1.20.1 · Forge' : S.selected.mc ? `Профиль: ${S.selected.mc} · ${LOADER_NAME[S.selected.loader]}` : 'Версия не выбрана';
  $('#mods-warn').textContent = ok
    ? (M.space === 'mf' ? 'Эти моды относятся только к сборке Medieval Fantasy (Minecraft 1.20.1 · Forge) и не затрагивают обычный Minecraft.' : 'У каждой версии и загрузчика своя папка с модами: установка в одном профиле не затрагивает другие.')
    : 'Моды работают с Fabric или Forge. Закройте окно, выберите загрузчик под списком версий и откройте «Моды» снова.';
  M.detail = null;
  showModsPane();
  if (!ok) return;
  await loadInstalled();
  if (M.tab === 'catalog') searchMods(true);
  else renderInstalled();
}

async function loadInstalled() {
  try { M.inst = await call('mods:installed', modProfile()); } catch (e) { M.inst = { entries: [], manual: [] }; fail(e); }
}

async function searchMods(reset = true) {
  if (!modsReady()) return;
  if (reset) { M.offset = 0; M.hits = []; }
  const my = ++M.token;
  M.loading = true;
  renderModList();
  try {
    const r = await call('mods:search', { ...modProfile(), q: M.q, sort: M.q && !M.sortTouched ? 'relevance' : M.sort, category: M.cat, onlyCompat: M.compat, offset: M.offset });
    if (my !== M.token) return;
    M.hits = reset ? r.hits : M.hits.concat(r.hits);
    M.total = r.total;
    M.offset = M.hits.length;
  } catch (e) {
    if (my === M.token) fail(e);
  } finally {
    if (my === M.token) { M.loading = false; renderModList(); }
  }
}

function renderModList() {
  const list = $('#mods-list');
  list.textContent = '';
  if (!M.hits.length) list.append(h('div', { class: 'empty', text: M.loading ? 'Загрузка…' : 'Ничего не найдено' }));
  for (const hit of M.hits) {
    const has = M.inst.entries.some((e) => e.projectId === hit.id);
    list.append(h('div', { class: 'mod-card' },
      modIcon(hit.icon, hit.title),
      h('div', { class: 'm-info' },
        h('div', { class: 'm-title' }, hit.title, h('span', { class: 'm-author', text: ' · ' + hit.author })),
        h('div', { class: 'm-desc', text: hit.description }),
        h('div', { class: 'm-meta', text: `⬇ ${fmtNum(hit.downloads)}` + (hit.categories.length ? ' · ' + hit.categories.slice(0, 3).join(', ') : '') })
      ),
      h('div', { class: 'm-actions' },
        h('button', { class: 'btn ghost small', text: 'Подробнее', onclick: () => openModDetail(hit.id) }),
        h('button', { class: 'btn play small', text: has ? 'Установлен' : 'Установить', disabled: has || M.busy, onclick: () => installMod(hit.id, hit.title) })
      )
    ));
  }
  $('#mods-more').classList.toggle('hidden', M.loading || M.hits.length >= M.total);
}

async function openModDetail(id) {
  M.detail = { id };
  showModsPane();
  const box = $('#mods-detail');
  box.textContent = '';
  box.append(h('div', { class: 'empty', text: 'Загрузка…' }));
  try {
    const d = await call('mods:project', { ...modProfile(), projectId: id });
    if (!M.detail || M.detail.id !== id) return;
    const has = M.inst.entries.some((e) => e.projectId === id);
    box.textContent = '';
    box.append(
      h('div', { class: 'row' }, h('button', { class: 'btn ghost small', text: '← Назад к каталогу', onclick: () => { M.detail = null; showModsPane(); renderModList(); } })),
      h('div', { class: 'mod-detail-head' },
        modIcon(d.icon, d.title),
        h('div', { class: 'm-info' },
          h('h3', { text: d.title }),
          h('div', { class: 'm-meta', text: `Автор: ${d.author || '—'} · ⬇ ${fmtNum(d.downloads)} · ♥ ${fmtNum(d.followers)}` }),
          h('div', { class: 'm-meta', text: `Загрузчики: ${d.loaders.map((l) => LOADER_NAME[l] || l).join(', ') || '—'} · Версии: ${d.versions.join(', ') || '—'}` })
        ),
        h('div', { class: 'm-actions' },
          h('button', { class: 'btn play small', text: has ? 'Установлен' : 'Установить', disabled: has || !d.compat.ok || M.busy, onclick: () => installMod(id, d.title) }),
          h('button', { class: 'btn ghost small', text: 'На Modrinth', onclick: () => call('link:open', `https://modrinth.com/mod/${d.slug}`).catch(fail) })
        )
      ),
      d.compat.ok
        ? h('div', { class: 'm-compat ok', text: `Совместим с ${modProfile().mc} · ${LOADER_NAME[modProfile().loader]}. Будет установлена версия ${d.compat.versionNumber}.` })
        : h('div', { class: 'm-compat bad', text: d.compat.reason }),
      h('div', { text: d.description }),
      d.gallery.length ? h('div', { class: 'gallery' }, d.gallery.map((g) => h('img', { src: g.url, alt: g.title, title: g.title, loading: 'lazy', referrerpolicy: 'no-referrer' }))) : null,
      d.body ? h('div', { class: 'm-body', text: d.body }) : null
    );
  } catch (e) {
    fail(e);
    M.detail = null;
    showModsPane();
  }
}

function showModProgress(on, text, pct) {
  $('#mods-prog').classList.toggle('hidden', !on);
  if (text != null) $('#mods-prog-text').textContent = text;
  if (pct != null) $('#mods-prog-fill').style.width = pct + '%';
}

async function installMod(pid, title, versionId) {
  if (M.busy) return;
  M.busy = true;
  renderModList();
  try {
    const pl = await call('mods:plan', { ...modProfile(), projectId: pid, versionId });
    if (!pl.items.length) { toast(`«${title}» уже установлен`); return; }
    const deps = pl.items.filter((i) => i.isDep);
    if (deps.length || pl.optional.length) {
      let msg = `Установить «${title}»?`;
      if (deps.length) msg += `\n\nНеобходимые моды (будут установлены тоже):\n` + deps.map((d) => `• ${d.title} ${d.versionNumber}`).join('\n');
      if (pl.optional.length) msg += `\n\nРекомендуемые (не устанавливаются автоматически):\n` + pl.optional.map((d) => `• ${d.title}`).join('\n');
      if (!confirm(msg)) return;
    }
    showModProgress(true, 'Подготовка…', 0);
    const r = await call('mods:install', { ...modProfile(), projectId: pid, versionId });
    toast(`Установлено: ${r.installed.map((i) => i.title).join(', ')}`);
  } catch (e) {
    if (/отменена/.test(e.message)) toast('Установка отменена'); else fail(e);
  } finally {
    M.busy = false;
    showModProgress(false);
    await loadInstalled();
    renderModList();
    renderInstalled();
    if (M.detail) openModDetail(M.detail.id);
  }
}

function renderInstalled() {
  const list = $('#mods-inst-list');
  list.textContent = '';
  const { entries, manual } = M.inst;
  if (!entries.length && !manual.length) list.append(h('div', { class: 'empty', text: 'В этом профиле модов пока нет. Найдите их во вкладке «Каталог».' }));
  for (const e of entries) {
    const upd = M.updates[e.projectId];
    list.append(h('div', { class: 'mod-card' },
      modIcon(e.icon, e.title),
      h('div', { class: 'm-info' },
        h('div', { class: 'm-title' }, e.title, e.isDep ? h('span', { class: 'badge dep', text: ' зависимость' }) : null, upd ? h('span', { class: 'badge upd', text: ' доступно ' + upd.versionNumber }) : null),
        h('div', { class: 'm-meta', text: `Версия ${e.versionNumber} · ${e.filename}` + (e.requiredBy.length ? ` · нужен для: ${e.requiredBy.join(', ')}` : '') })
      ),
      h('div', { class: 'm-actions' },
        upd ? h('button', { class: 'btn play small', text: 'Обновить', disabled: M.busy, onclick: () => installMod(e.projectId, e.title, upd.versionId) }) : null,
        h('button', { class: 'btn danger small', text: 'Удалить', disabled: M.busy, onclick: () => removeMod(e) })
      )
    ));
  }
  for (const f of manual) {
    list.append(h('div', { class: 'mod-card' },
      h('div', { class: 'm-icon ph', text: '?' }),
      h('div', { class: 'm-info' }, h('div', { class: 'm-title' }, f.filename, h('span', { class: 'badge dep', text: ' добавлен вручную' })), h('div', { class: 'm-meta', text: `${(f.size / 1048576).toFixed(2)} МБ` })),
      h('div', { class: 'm-actions' }, h('button', { class: 'btn danger small', text: 'Удалить', disabled: M.busy, onclick: () => removeMod({ filename: f.filename, title: f.filename, requiredBy: [] }) }))
    ));
  }
}

async function removeMod(e) {
  let msg = `Удалить «${e.title}»?`;
  if (e.requiredBy && e.requiredBy.length) msg += `\n\nВнимание: он нужен для: ${e.requiredBy.join(', ')}. Без него эти моды могут не запуститься.`;
  if (!confirm(msg)) return;
  try {
    await call('mods:remove', { ...modProfile(), projectId: e.projectId, filename: e.projectId ? undefined : e.filename });
    delete M.updates[e.projectId];
    await loadInstalled();
    renderInstalled();
    renderModList();
  } catch (err) { fail(err); }
}

async function checkModUpdates() {
  const b = $('#mods-check');
  b.disabled = true;
  try {
    const up = await call('mods:updates', modProfile());
    M.updates = Object.fromEntries(up.map((u) => [u.projectId, u]));
    toast(up.length ? `Доступно обновлений: ${up.length}` : 'Все моды актуальны');
    renderInstalled();
  } catch (e) { fail(e); } finally { b.disabled = false; }
}

function bindMods() {
  $('#btn-mods').onclick = () => openMods(null);
  const sortSel = $('#mods-sort');
  MOD_SORTS.forEach(([v, t]) => sortSel.append(h('option', { value: v, text: t })));
  const catSel = $('#mods-cat');
  MOD_CATS.forEach(([v, t]) => catSel.append(h('option', { value: v, text: t })));

  $('#mods-q').addEventListener('input', (e) => {
    M.q = e.target.value.trim();
    clearTimeout(M.timer);
    M.timer = setTimeout(() => { M.detail = null; showModsPane(); searchMods(true); }, 400);
  });
  sortSel.addEventListener('change', () => { M.sort = sortSel.value; M.sortTouched = true; searchMods(true); });
  catSel.addEventListener('change', () => { M.cat = catSel.value; searchMods(true); });
  $('#mods-compat').addEventListener('change', (e) => { M.compat = e.target.checked; searchMods(true); });
  $('#mods-more').onclick = () => searchMods(false);
  $$('#mods-tabs button').forEach((b) => b.addEventListener('click', () => {
    M.tab = b.dataset.mtab;
    M.detail = null;
    showModsPane();
    if (M.tab === 'catalog') { if (!M.hits.length) searchMods(true); else renderModList(); }
    else loadInstalled().then(renderInstalled);
  }));
  $('#mods-check').onclick = checkModUpdates;
  $('#mods-folder').onclick = () => call('folder:open', 'mods', modProfile()).catch(fail);
  $('#mods-cancel').onclick = () => call('mods:cancel').catch(fail);
  window.api.on('mods:progress', ({ text, percent }) => showModProgress(true, text, percent));
}

/* ---------- Medieval Fantasy ---------- */
const F = { st: null, settings: null, presets: {}, updates: [], names: {} };
const mfOpen = () => !$('#mf').classList.contains('hidden');

function mfShow(on) {
  $('#mf').classList.toggle('hidden', !on);
  if (window.MFBg) { if (on) window.MFBg.start(); else window.MFBg.stop(); }
}

async function mfRefresh() {
  try { F.st = await call('mf:status'); } catch (e) { fail(e); return; }
  mfRender();
}

function mfRender() {
  const st = F.st;
  if (!st) return;
  const busy = S.state !== 'idle';
  const info = $('#mf-info');
  info.textContent = '';
  const row = (k, v, cls) => info.append(h('div', { class: 'k', text: k }), h('div', { class: 'v' + (cls ? ' ' + cls : ''), text: v }));
  row('Сборка', `${st.name} ${st.packVersion}`);
  row('Игра', `Minecraft ${st.mc} · ${st.loader}`);
  row('Состояние', st.installed ? `Установлена · модов: ${st.modsCount}` : 'Не установлена', st.installed ? 'ok' : 'no');
  row('Папка', st.dir);
  $('#mf-play-label').textContent = busy ? (S.state === 'running' ? 'Игра запущена' : 'Установка…') : st.installed ? 'Играть' : 'Установить и играть';
  $('#mf-play-sub').textContent = st.installed ? '' : 'Скачает Forge и моды сборки (несколько ГБ)';
  $('#mf-play').disabled = busy;
  $('#mf-continue').disabled = busy || !st.installed;
  $('#mf-continue').title = st.installed ? '' : 'Сначала установите сборку';
  $('#mf-stop').classList.toggle('hidden', S.state !== 'running');
  $('#mf-report-btn').classList.toggle('hidden', !(st.state && st.state.report));
}

function mfProgress(on, text, pct) {
  $('#mf-prog').classList.toggle('hidden', !on);
  if (text != null) $('#mf-prog-text').textContent = text;
  const f = $('#mf-prog-fill');
  if (pct == null) f.classList.add('indet');
  else { f.classList.remove('indet'); f.style.width = pct + '%'; }
}

function renderReport(rep) {
  const box = $('#mf-report-body');
  box.textContent = '';
  const bad = rep.failed || [];
  box.append(h('div', { class: 'rep-row ' + (rep.ok === false ? 'r-bad' : 'r-ok'), text: bad.length ? `Установлено: ${(rep.installed || []).length}. Не установлено: ${bad.length}.` : `Всё установлено: ${(rep.installed || []).length} модов.` }));
  for (const f of bad) {
    box.append(h('div', { class: 'rep-row' }, h('span', { class: f.required ? 'r-bad' : 'r-warn', text: (f.required ? '✕ Обязательный: ' : '! ') + f.title }), h('small', { text: f.reason })));
  }
  if (bad.length) box.append(h('div', { class: 'hint', text: 'Мод не устанавливается, если у него нет версии именно для Minecraft 1.20.1 и Forge, либо он несовместим с уже установленными. Версию игры лаунчер не меняет.' }));
  for (const t of rep.installed || []) box.append(h('div', { class: 'rep-row r-ok', text: '✓ ' + t }));
  for (const t of rep.extras || []) box.append(h('div', { class: 'rep-row r-ok', text: '✓ ' + t }));
  for (const sk of rep.skipped || []) box.append(h('div', { class: 'rep-row' }, h('span', { class: 'r-warn', text: '— Не ставится: ' + sk.title }), h('small', { text: sk.reason })));
  for (const sh of rep.removedShaders || []) box.append(h('div', { class: 'rep-row' }, h('span', { class: 'r-warn', text: '— Шейдер убран: ' + sh.slug }), h('small', { text: sh.reason })));
  if (rep.story) box.append(h('div', { class: 'rep-row r-ok', text: '✓ Сюжетные задания (4 цепочки, достижения) — датапак подключён через Paxi' }));
}

async function mfInstall() {
  mfProgress(true, 'Подготовка…', null);
  try {
    const rep = await call('mf:install');
    renderReport(rep);
    $('#m-mf-report').classList.add('open');
    return rep;
  } catch (e) {
    if (/отменена/.test(e.message)) toast('Установка отменена'); else fail(e);
    return null;
  } finally {
    mfProgress(false);
    await mfRefresh();
  }
}

async function mfPlay(world) {
  if (S.state !== 'idle') return;
  if (!S.active) { toast('Сначала добавьте аккаунт.', 'error'); openModal('m-account'); return; }
  try {
    if (!F.st.installed) {
      if (!confirm('Сборка Medieval Fantasy ещё не установлена.\n\nБудут скачаны Forge для Minecraft 1.20.1 и моды сборки (это может занять много времени и несколько ГБ). Установить?')) return;
      const rep = await mfInstall();
      if (!rep) return;
      if (!rep.ok && !confirm('Не все обязательные моды установились (см. отчёт). Запустить всё равно?')) return;
      if (rep.ok && !(rep.failed || []).length) $('#m-mf-report').classList.remove('open');
    }
    mfProgress(true, 'Запуск…', null);
    await call('mf:play', { world });
  } catch (e) {
    fail(e);
  } finally {
    await mfRefresh();
  }
}

async function openWorlds() {
  const list = $('#mf-world-list');
  list.textContent = '';
  try {
    const ws = await call('mf:worlds');
    if (!ws.length) list.append(h('div', { class: 'empty', text: 'Миров пока нет. Нажмите «Играть» и создайте мир.' }));
    for (const w of ws) {
      list.append(h('div', { class: 'mod-card' },
        h('div', { class: 'm-icon ph', text: '⛰' }),
        h('div', { class: 'm-info' }, h('div', { class: 'm-title', text: w.name }), h('div', { class: 'm-meta', text: 'Последний вход: ' + new Date(w.lastPlayed).toLocaleString('ru-RU') })),
        h('div', { class: 'm-actions' }, h('button', { class: 'btn play small', text: 'Играть', disabled: S.state !== 'idle' || !F.st.installed, onclick: () => { closeModals(); mfPlay(w.name); } }))
      ));
    }
  } catch (e) { fail(e); }
  $('#m-mf-worlds').classList.add('open');
}

async function continueAdventure() {
  try {
    const ws = await call('mf:worlds');
    if (!ws.length) { toast('Миров пока нет — начните новое приключение кнопкой «Играть».'); return; }
    mfPlay(ws[0].name);
  } catch (e) { fail(e); }
}

function renderGfx() {
  const s = F.settings;
  $('#mf-presets').textContent = '';
  for (const [id, p] of Object.entries(F.presets)) {
    $('#mf-presets').append(h('button', { class: s.preset === id ? 'active' : '', text: p.label, onclick: async () => {
      try { F.settings = await call('mf:applyPreset', id); renderGfx(); } catch (e) { fail(e); }
    } }));
  }
  const p = F.presets[s.preset];
  $('#mf-preset-hint').textContent = p
    ? `Дальность ${p.renderDistance} чанков, память ${(p.ramMb / 1024).toFixed(0)} ГБ, шейдеры ${p.shaders ? 'включены' : 'выключены'}.`
    : 'Свой набор параметров.';
  const maxRam = Math.max(4096, Math.min(32768, Math.floor((S.info.totalMb * 0.8) / 512) * 512));
  $('#mf-ram').max = maxRam;
  $('#mf-ram').value = Math.min(s.ramMb, maxRam);
  $('#mf-ram-label').textContent = ($('#mf-ram').value / 1024).toFixed(1) + ' ГБ';
  $('#mf-rd').value = s.renderDistance;
  $('#mf-rd-label').textContent = s.renderDistance + ' чанков';
  $('#mf-sd').value = s.simulationDistance;
  $('#mf-sd-label').textContent = s.simulationDistance + ' чанков';
}

async function openGfx() {
  try {
    const r = await call('mf:getSettings');
    F.settings = r.settings; F.presets = r.presets;
    renderGfx();
    $('#m-mf-gfx').classList.add('open');
  } catch (e) { fail(e); }
}

async function renderShaders() {
  const box = $('#mf-shader-list');
  const rec = $('#mf-shader-rec');
  box.textContent = ''; rec.textContent = '';
  try {
    const d = await call('mf:shaders');
    if (!d.installed.length) box.append(h('div', { class: 'empty', text: 'Шейдеров пока нет. Установите рекомендуемые ниже.' }));
    else {
      box.append(h('div', { class: 'mod-card' }, h('div', { class: 'm-info' }, h('div', { class: 'm-title', text: 'Без шейдеров' })),
        h('div', { class: 'm-actions' }, h('button', { class: 'btn ghost small', text: d.selected ? 'Выбрать' : 'Выбрано', disabled: !d.selected, onclick: () => call('mf:setShader', null).then(renderShaders).catch(fail) }))));
    }
    for (const n of d.installed) {
      box.append(h('div', { class: 'mod-card' }, h('div', { class: 'm-info' }, h('div', { class: 'm-title', text: n })),
        h('div', { class: 'm-actions' }, h('button', { class: 'btn play small', text: d.selected === n ? 'Выбрано' : 'Выбрать', disabled: d.selected === n, onclick: () => call('mf:setShader', n).then(renderShaders).catch(fail) }))));
    }
    for (const r of d.recommended) {
      rec.append(h('div', { class: 'mod-card' }, h('div', { class: 'm-info' }, h('div', { class: 'm-title', text: r.title })),
        h('div', { class: 'm-actions' }, h('button', { class: 'btn ghost small', text: 'Установить', disabled: S.state !== 'idle', onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'Загрузка…';
          try { const x = await call('mf:installExtra', { kind: 'shader', slug: r.slug }); toast(`Установлено: ${x.title}`); }
          catch (e) { fail(e); }
          renderShaders();
        } }))));
    }
  } catch (e) { fail(e); }
}

async function mfCheckUpdates() {
  const b = $('#mf-check');
  b.disabled = true;
  const list = $('#mf-update-list');
  list.textContent = '';
  try {
    const inst = await call('mods:installed', { mc: '1.20.1', loader: 'forge', space: 'mf' });
    const names = Object.fromEntries(inst.entries.map((e) => [e.projectId, e]));
    F.updates = await call('mf:updates');
    if (!F.updates.length) list.append(h('div', { class: 'empty', text: inst.entries.length ? 'Все моды актуальны.' : 'Моды ещё не установлены.' }));
    for (const u of F.updates) {
      const e = names[u.projectId];
      list.append(h('div', { class: 'rep-row' }, `${e ? e.title : u.projectId}: ${e ? e.versionNumber : '?'} → ${u.versionNumber}`));
    }
    $('#mf-update-all').classList.toggle('hidden', !F.updates.length);
  } catch (e) { fail(e); } finally { b.disabled = false; }
}

function bindMf() {
  $('#btn-mf').onclick = async () => { mfShow(true); await mfRefresh(); };
  $('#mf-back').onclick = () => mfShow(false);
  $('#mf-play').onclick = () => mfPlay(null);
  $('#mf-continue').onclick = continueAdventure;
  $('#mf-stop').onclick = () => call('game:stop').catch(fail);
  $('#mf-worlds').onclick = openWorlds;
  $('#mf-mods').onclick = () => openMods('mf');
  $('#mf-gfx').onclick = openGfx;
  $('#mf-shaders').onclick = async () => { await renderShaders(); $('#m-mf-shaders').classList.add('open'); };
  $('#mf-update').onclick = () => { $('#mf-update-list').textContent = ''; $('#mf-update-all').classList.add('hidden'); $('#m-mf-update').classList.add('open'); };
  $('#mf-folder').onclick = () => call('mf:openFolder', '').catch(fail);
  $('#mf-open-saves').onclick = () => call('mf:openFolder', 'saves').catch(fail);
  $('#mf-open-shaders').onclick = () => call('mf:openFolder', 'shaders').catch(fail);
  $('#mf-cancel').onclick = () => call('mf:cancel').catch(fail);
  $('#mf-report-btn').onclick = () => { renderReport(F.st.state.report); $('#m-mf-report').classList.add('open'); };

  const upd = async (patch) => {
    try { F.settings = await call('mf:setSettings', { ...patch, preset: 'custom' }); renderGfx(); } catch (e) { fail(e); }
  };
  $('#mf-ram').addEventListener('input', (e) => { $('#mf-ram-label').textContent = (e.target.value / 1024).toFixed(1) + ' ГБ'; });
  $('#mf-ram').addEventListener('change', (e) => upd({ ramMb: Number(e.target.value) }));
  $('#mf-rd').addEventListener('input', (e) => { $('#mf-rd-label').textContent = e.target.value + ' чанков'; });
  $('#mf-rd').addEventListener('change', (e) => upd({ renderDistance: Number(e.target.value) }));
  $('#mf-sd').addEventListener('input', (e) => { $('#mf-sd-label').textContent = e.target.value + ' чанков'; });
  $('#mf-sd').addEventListener('change', (e) => upd({ simulationDistance: Number(e.target.value) }));

  $('#mf-check').onclick = mfCheckUpdates;
  $('#mf-update-all').onclick = async () => {
    const b = $('#mf-update-all');
    b.disabled = true;
    mfProgress(true, 'Обновление модов…', null);
    try {
      const r = await call('mf:update');
      toast(`Обновлено модов: ${r.updated}` + (r.failed.length ? `, ошибок: ${r.failed.length}` : ''), r.failed.length ? 'error' : 'info');
      await mfCheckUpdates();
    } catch (e) { if (/отменена/.test(e.message)) toast('Обновление отменено'); else fail(e); }
    finally { b.disabled = false; mfProgress(false); mfRefresh(); }
  };
  $('#mf-reinstall').onclick = async () => {
    if (S.state !== 'idle') { toast('Лаунчер занят.', 'error'); return; }
    if (!confirm('Проверить сборку и доустановить недостающие моды? Уже установленные не скачиваются заново.')) return;
    closeModals();
    await mfInstall();
  };

  window.api.on('mf:progress', ({ text, percent }) => {
    if (!text && !percent) { mfProgress(false); return; }
    mfProgress(true, text, percent == null ? null : percent);
  });
  window.api.on('state', (st) => { if (st === 'idle') mfProgress(false); if (mfOpen()) mfRefresh(); });
}

init();
