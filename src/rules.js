'use strict';
const os = require('os');

function osInfo() {
  return {
    name: 'windows',
    arch: process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64',
    version: os.release(),
  };
}

function ruleMatches(rule, info = osInfo(), features = {}) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== info.name) return false;
    if (rule.os.arch && rule.os.arch !== info.arch) return false;
    if (rule.os.version && !new RegExp(rule.os.version).test(info.version)) return false;
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (!!features[k] !== v) return false;
    }
  }
  return true;
}

function allowed(rules, info, features) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) {
    if (ruleMatches(r, info, features)) ok = r.action === 'allow';
  }
  return ok;
}

function mavenPath(name) {
  const [coord, ext = 'jar'] = name.split('@');
  const p = coord.split(':');
  const g = p[0].replace(/\./g, '/');
  const a = p[1];
  const v = p[2];
  const c = p[3];
  return `${g}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}

module.exports = { osInfo, ruleMatches, allowed, mavenPath };
