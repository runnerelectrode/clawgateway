import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';

const OPENCLAW_DIR = join(homedir(), '.openclaw');

const TOOL_PROFILES = {
  minimal: { label: 'Minimal', tools: ['session_status'] },
  coding: { label: 'Coding', tools: ['read', 'write', 'edit', 'apply_patch', 'exec', 'bash', 'memory_search', 'memory_get'] },
  messaging: { label: 'Messaging', tools: ['message_send', 'session_status', 'session_list'] },
  full: { label: 'Full Access', tools: ['(all tools)'] }
};

const TOOL_GROUPS = {
  'group:fs': ['read', 'write', 'edit', 'apply_patch'],
  'group:runtime': ['exec', 'bash', 'process'],
  'group:sessions': ['session_status', 'session_list', 'session_reset'],
  'group:memory': ['memory_search', 'memory_get']
};

const ALL_TOOLS = [
  'read', 'write', 'edit', 'apply_patch',
  'exec', 'bash', 'process',
  'web_fetch', 'web_search', 'browser',
  'memory_search', 'memory_get',
  'session_status', 'session_list', 'session_reset',
  'message_send', 'elevated'
];

function getProfileConfigPath(profileName) {
  return join(OPENCLAW_DIR, `openclaw-${profileName}.json`);
}

export function readProfileConfig(profileName) {
  const path = getProfileConfigPath(profileName);
  if (!existsSync(path)) {
    return { exists: false, path, config: null };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    // JSON5 compat: strip comments and trailing commas
    const cleaned = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([\]}])/g, '$1');
    const config = JSON.parse(cleaned);
    return { exists: true, path, config };
  } catch (err) {
    return { exists: false, path, config: null, error: err.message };
  }
}

function ensureOpenClawDir() {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true });
  }
}

export function writeProfileToolConfig(profileName, toolConfig) {
  ensureOpenClawDir();
  const path = getProfileConfigPath(profileName);
  let config = {};

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8');
      const cleaned = raw
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([\]}])/g, '$1');
      config = JSON.parse(cleaned);
    } catch {
      config = {};
    }
  }

  config.tools = {
    ...config.tools,
    ...toolConfig
  };

  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return config;
}

export function listProfiles(roles) {
  const result = {};
  for (const [roleName, roleConfig] of Object.entries(roles)) {
    const profileName = roleName; // profile name matches role name
    const { exists, path, config, error } = readProfileConfig(profileName);

    const tools = config?.tools || {};
    result[roleName] = {
      profileName,
      configPath: path,
      configExists: exists,
      error,
      upstream: typeof roleConfig === 'string' ? roleConfig : roleConfig.upstream,
      description: typeof roleConfig === 'object' ? roleConfig.description : '',
      token: typeof roleConfig === 'object' ? (roleConfig.token || '') : '',
      apiKey: config?.auth?.anthropic?.apiKey || '',
      model: config?.agents?.defaults?.model?.primary || '',
      toolProfile: tools.profile || '(default)',
      toolAllow: tools.allow || [],
      toolDeny: tools.deny || [],
      effectiveTools: resolveEffectiveTools(tools)
    };
  }
  return result;
}

function resolveEffectiveTools(toolConfig) {
  if (!toolConfig.profile && !toolConfig.allow && !toolConfig.deny) {
    return ALL_TOOLS; // default = full access
  }

  let allowed = new Set();

  // Start with profile base
  if (toolConfig.profile && TOOL_PROFILES[toolConfig.profile]) {
    if (toolConfig.profile === 'full') {
      allowed = new Set(ALL_TOOLS);
    } else {
      allowed = new Set(TOOL_PROFILES[toolConfig.profile].tools);
    }
  }

  // Add explicit allows (expand groups)
  if (toolConfig.allow) {
    for (const tool of toolConfig.allow) {
      if (TOOL_GROUPS[tool]) {
        for (const t of TOOL_GROUPS[tool]) allowed.add(t);
      } else {
        allowed.add(tool);
      }
    }
  }

  // Remove denies (expand groups, deny wins)
  if (toolConfig.deny) {
    for (const tool of toolConfig.deny) {
      if (TOOL_GROUPS[tool]) {
        for (const t of TOOL_GROUPS[tool]) allowed.delete(t);
      } else {
        allowed.delete(tool);
      }
    }
  }

  return [...allowed];
}

export function writeProfileConfig(profileName, patch) {
  ensureOpenClawDir();
  const path = getProfileConfigPath(profileName);
  let config = {};

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8');
      const cleaned = raw
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,\s*([\]}])/g, '$1');
      config = JSON.parse(cleaned);
    } catch {
      config = {};
    }
  }

  // Deep merge patch into config
  for (const [key, val] of Object.entries(patch)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      config[key] = { ...(config[key] || {}), ...val };
    } else {
      config[key] = val;
    }
  }

  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return config;
}

export function getInstanceStatus(upstream) {
  // Check if OpenClaw instance is running by attempting a HEAD request
  return new Promise((resolve) => {
    const url = new URL(upstream);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: '/',
      method: 'HEAD',
      timeout: 2000
    }, () => resolve('running'));
    req.on('error', () => resolve('stopped'));
    req.on('timeout', () => { req.destroy(); resolve('stopped'); });
    req.end();
  });
}

const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'openai/o3', name: 'o3', provider: 'openai' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' }
];

export { TOOL_PROFILES, TOOL_GROUPS, ALL_TOOLS, AVAILABLE_MODELS, OPENCLAW_DIR };
