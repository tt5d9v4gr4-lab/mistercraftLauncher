'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:info', 'win:min', 'win:max', 'win:close',
  'versions:manifest', 'versions:installed', 'versions:delete', 'loaders:support',
  'game:play', 'game:stop', 'game:state', 'game:log',
  'settings:get', 'settings:set',
  'accounts:list', 'accounts:addOffline', 'accounts:select', 'accounts:remove',
  'auth:microsoft', 'auth:cancel',
  'java:list', 'java:browse',
  'folder:open', 'link:open',
  'skins:list', 'skins:import', 'skins:save', 'skins:delete', 'skins:apply', 'skins:variant',
  'mf:status', 'mf:getSettings', 'mf:setSettings', 'mf:applyPreset', 'mf:worlds', 'mf:shaders', 'mf:setShader', 'mf:cancel',
  'mf:openFolder', 'mf:installExtra', 'mf:updates', 'mf:update', 'mf:install', 'mf:play',
  'mods:search', 'mods:project', 'mods:plan', 'mods:install', 'mods:cancel', 'mods:installed', 'mods:remove', 'mods:updates',
]);
const EVENTS = new Set(['progress', 'state', 'log', 'auth:code', 'toast', 'mods:progress', 'mf:progress']);

contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...args) => {
    if (!INVOKE.has(ch)) return Promise.reject(new Error('Недопустимый канал: ' + ch));
    return ipcRenderer.invoke(ch, ...args);
  },
  on: (ch, cb) => {
    if (!EVENTS.has(ch)) throw new Error('Недопустимое событие: ' + ch);
    const f = (_e, d) => cb(d);
    ipcRenderer.on(ch, f);
    return () => ipcRenderer.removeListener(ch, f);
  },
});
