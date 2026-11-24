'use strict';
const crypto = require('crypto');
const { fetchRetry } = require('./http');

const TENANT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';

const XERR = {
  2148916233: 'У этой учётной записи Microsoft нет профиля Xbox. Создайте его на xbox.com и повторите вход.',
  2148916235: 'Xbox Live недоступен в вашей стране.',
  2148916236: 'Для этой учётной записи требуется подтверждение возраста (Xbox).',
  2148916237: 'Для этой учётной записи требуется подтверждение возраста (Xbox).',
  2148916238: 'Детскую учётную запись нужно добавить в семейную группу Microsoft.',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postForm(url, params) {
  const r = await fetchRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function postJson(url, body, headers = {}) {
  const r = await fetchRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

/** XBL -> XSTS -> Minecraft services -> профиль. */
async function xboxChain(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (xbl.status !== 200) throw new Error('Ошибка авторизации Xbox Live (' + xbl.status + ')');

  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (xsts.status !== 200) {
    throw new Error(XERR[xsts.data.XErr] || 'Ошибка XSTS (' + xsts.status + ')');
  }
  const uhs = xsts.data.DisplayClaims.xui[0].uhs;

  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}`,
  });
  if (mc.status !== 200 || !mc.data.access_token) throw new Error('Не удалось войти в Minecraft Services (' + mc.status + ')');

  const pr = await fetchRetry('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + mc.data.access_token },
  });
  if (pr.status === 404) throw new Error('На этом аккаунте нет лицензии Minecraft: Java Edition.');
  if (!pr.ok) throw new Error('Не удалось получить профиль Minecraft (' + pr.status + ')');
  const profile = await pr.json();

  return {
    token: mc.data.access_token,
    expires: Date.now() + (mc.data.expires_in || 86400) * 1000,
    id: profile.id,
    name: profile.name,
  };
}

/** Вход по коду устройства. onCode({userCode, url}) показывает код пользователю. */
async function deviceLogin(clientId, onCode, signal) {
  if (!clientId) throw new Error('Не указан Azure Client ID (см. окно «Аккаунт»).');
  const dc = await postForm(`${TENANT}/devicecode`, { client_id: clientId, scope: SCOPE });
  if (dc.status !== 200) throw new Error(dc.data.error_description || 'Не удалось начать вход Microsoft');
  onCode({ userCode: dc.data.user_code, url: dc.data.verification_uri, expiresIn: dc.data.expires_in });

  let interval = (dc.data.interval || 5) * 1000;
  const deadline = Date.now() + (dc.data.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    if (signal && signal.aborted) throw new Error('Вход отменён');
    const t = await postForm(`${TENANT}/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: dc.data.device_code,
    });
    if (t.status === 200) {
      const mc = await xboxChain(t.data.access_token);
      return {
        id: mc.id,
        type: 'microsoft',
        name: mc.name,
        uuid: mc.id,
        refreshToken: t.data.refresh_token,
        mcToken: mc.token,
        mcExpires: mc.expires,
      };
    }
    const err = t.data.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { interval += 5000; continue; }
    if (err === 'authorization_declined') throw new Error('Вход отклонён.');
    if (err === 'expired_token') throw new Error('Время действия кода истекло. Повторите вход.');
    throw new Error(t.data.error_description || 'Ошибка входа Microsoft: ' + err);
  }
  throw new Error('Время действия кода истекло. Повторите вход.');
}

/** Возвращает аккаунт со свежим токеном игры. */
async function ensureFresh(acc, clientId) {
  if (acc.type === 'offline') return { ...acc, mcToken: '0' };
  if (acc.mcToken && acc.mcExpires - 60000 > Date.now()) return acc;
  if (!clientId) throw new Error('Не указан Azure Client ID — войдите в аккаунт заново.');
  const t = await postForm(`${TENANT}/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: acc.refreshToken,
    scope: SCOPE,
  });
  if (t.status !== 200) throw new Error('Сессия Microsoft истекла. Войдите в аккаунт заново.');
  const mc = await xboxChain(t.data.access_token);
  return {
    ...acc,
    name: mc.name,
    uuid: mc.id,
    refreshToken: t.data.refresh_token || acc.refreshToken,
    mcToken: mc.token,
    mcExpires: mc.expires,
  };
}

function offlineUuid(name) {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b.toString('hex');
}

function validName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(name);
}

function offlineAccount(name) {
  if (!validName(name)) throw new Error('Ник: 3–16 символов, только латиница, цифры и _');
  const uuid = offlineUuid(name);
  return { id: 'offline-' + uuid, type: 'offline', name, uuid };
}

module.exports = { deviceLogin, ensureFresh, offlineAccount, offlineUuid, validName, xboxChain };
