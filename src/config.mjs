import { readFileSync, writeFileSync, watchFile, unwatchFile } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_FIELDS = ['port', 'sessionSecret', 'auth', 'callbackUrl'];

function validate(config) {
  for (const field of REQUIRED_FIELDS) {
    if (config[field] == null) throw new Error(`Missing required config field: ${field}`);
  }
  if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}`);
  }
  if (typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 16) {
    throw new Error('sessionSecret must be at least 16 characters');
  }
  if (!Array.isArray(config.auth) || config.auth.length === 0) {
    throw new Error('auth must be a non-empty array of provider configs');
  }
  for (const auth of config.auth) {
    if (!auth.provider) throw new Error('Each auth entry must have a provider field');
    if (!['okta', 'workos', 'descope', 'twitter'].includes(auth.provider)) {
      throw new Error(`Unknown auth provider: ${auth.provider}`);
    }
    if (!auth.clientId) throw new Error(`${auth.provider}: missing clientId`);
    if (!auth.clientSecret) throw new Error(`${auth.provider}: missing clientSecret`);
  }

  const mode = config.mode || 'enterprise';
  if (mode === 'enterprise') {
    if (!config.roles || typeof config.roles !== 'object' || Object.keys(config.roles).length === 0) {
      throw new Error('Enterprise mode requires a non-empty roles object');
    }
    // Normalize roles: support both string URLs and { upstream, tools, token } objects
    for (const [key, val] of Object.entries(config.roles)) {
      if (typeof val === 'string') {
        config.roles[key] = { upstream: val, tools: [], description: '', token: '' };
      } else {
        if (!val.token) val.token = '';
      }
    }
  } else if (mode === 'marketplace') {
    if (!config.profiles || typeof config.profiles !== 'object' || Object.keys(config.profiles).length === 0) {
      throw new Error('Marketplace mode requires a non-empty profiles object');
    }
  } else {
    throw new Error(`Unknown mode: ${mode}. Must be "enterprise" or "marketplace"`);
  }

  return { ...config, mode };
}

export function loadConfig(configPath) {
  const abs = resolve(configPath);
  const raw = readFileSync(abs, 'utf-8');
  const parsed = JSON.parse(raw);
  return validate(parsed);
}

export function createConfigManager(configPath) {
  const abs = resolve(configPath);
  let current = loadConfig(abs);
  let debounceTimer = null;

  const onChange = () => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        const next = loadConfig(abs);
        current = next;
        console.log(`[config] Reloaded ${abs}`);
      } catch (err) {
        console.error(`[config] Reload failed: ${err.message}`);
      }
    }, 300);
  };

  watchFile(abs, { interval: 1000 }, onChange);

  return {
    getConfig() { return current; },
    saveConfig(patch) {
      const raw = readFileSync(abs, 'utf-8');
      const existing = JSON.parse(raw);
      const merged = { ...existing, ...patch };
      const validated = validate(merged);
      writeFileSync(abs, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      current = validated;
      return current;
    },
    getConfigPath() { return abs; },
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      unwatchFile(abs, onChange);
    }
  };
}
