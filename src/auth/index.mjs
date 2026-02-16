import { createOktaProvider } from './okta.mjs';
import { createWorkosProvider } from './workos.mjs';
import { createDescopeProvider } from './descope.mjs';
import { createTwitterProvider } from './twitter.mjs';

const FACTORIES = {
  okta: createOktaProvider,
  workos: createWorkosProvider,
  descope: createDescopeProvider,
  twitter: createTwitterProvider
};

export function createProvider(authConfig, callbackUrl) {
  const factory = FACTORIES[authConfig.provider];
  if (!factory) throw new Error(`Unknown auth provider: ${authConfig.provider}`);
  return factory(authConfig, callbackUrl);
}

export function createProviders(authConfigs, callbackUrl) {
  const providers = {};
  for (const cfg of authConfigs) {
    providers[cfg.provider] = createProvider(cfg, callbackUrl);
  }
  return providers;
}

export function resolveRole(groups, roleMapping) {
  if (!roleMapping || !groups) return roleMapping?.default || null;
  for (const group of groups) {
    if (roleMapping[group]) return roleMapping[group];
  }
  return roleMapping.default || null;
}
