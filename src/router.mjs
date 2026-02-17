import { URL } from 'node:url';
import { generatePKCE } from './auth/twitter.mjs';
import { resolveRole } from './auth/index.mjs';
import {
  parseCookies, verifySession, verifyState,
  setSessionCookie, setStateCookie, clearCookies,
  SESSION_COOKIE, STATE_COOKIE
} from './session.mjs';
import { proxyHttp, proxyWebSocket, pingUpstream } from './proxy.mjs';
import { renderLoginPage } from './ui/login.mjs';
import { renderAdminPage } from './ui/admin.mjs';
import { listProfiles, writeProfileToolConfig, writeProfileConfig } from './profiles.mjs';

// Health check cache (5s TTL)
let healthCache = { data: null, expiresAt: 0 };

// In-memory audit log (last 100 entries for admin dashboard)
const auditRecent = [];

export function createRouter({ getConfig, saveConfig, providers, rateLimiter, audit }) {
  // Wrap audit to also keep recent entries in memory
  const origLog = audit.log.bind(audit);
  audit.log = (entry) => {
    origLog(entry);
    auditRecent.unshift({ ts: new Date().toISOString(), ...entry });
    if (auditRecent.length > 100) auditRecent.pop();
  };

  function isAdmin(config, session) {
    if (!session) return false;
    if (session.role === 'admin') return true;
    if (config.admins && config.admins.includes(session.email)) return true;
    // In marketplace/dual mode, all authenticated users are admins of their session
    if ((config.mode === 'marketplace' || config.mode === 'dual') && !config.admins) return true;
    return false;
  }

  function isSecure(config) {
    return config.callbackUrl?.startsWith('https');
  }

  function getUpstreamForRole(config, role) {
    if (config.mode === 'enterprise' || config.mode === 'dual') {
      const r = config.roles?.[role];
      if (!r) return null;
      return typeof r === 'string' ? r : r.upstream;
    }
    return null;
  }

  function getUpstreamForProfile(config, profile) {
    if (config.mode === 'marketplace' || config.mode === 'dual') {
      const p = config.profiles?.[profile];
      return p?.upstream || null;
    }
    return null;
  }

  function getDefaultProfile(config) {
    if ((config.mode !== 'marketplace' && config.mode !== 'dual') || !config.profiles) return null;
    for (const [id, p] of Object.entries(config.profiles)) {
      if (p.default) return id;
    }
    return Object.keys(config.profiles)[0];
  }

  function getTokenForSession(config, session) {
    if (config.mode === 'enterprise') {
      const r = config.roles?.[session.role];
      return (r && typeof r === 'object') ? (r.token || '') : '';
    }
    if (config.mode === 'marketplace') {
      const p = config.profiles?.[session.profile];
      return p?.token || '';
    }
    if (config.mode === 'dual') {
      if (session.role) {
        const r = config.roles?.[session.role];
        return (r && typeof r === 'object') ? (r.token || '') : '';
      }
      if (session.profile) {
        const p = config.profiles?.[session.profile];
        return p?.token || '';
      }
    }
    return '';
  }

  function getUpstreamForSession(config, session) {
    if (config.mode === 'enterprise') {
      return getUpstreamForRole(config, session.role);
    }
    if (config.mode === 'marketplace') {
      return getUpstreamForProfile(config, session.profile);
    }
    if (config.mode === 'dual') {
      if (session.role) return getUpstreamForRole(config, session.role);
      return getUpstreamForProfile(config, session.profile);
    }
    return null;
  }

  function redirect(res, url, status = 302) {
    res.writeHead(status, { Location: url });
    res.end();
  }

  function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // --- Request handler ---
  async function handleRequest(req, res) {
    const config = getConfig();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // --- Public routes ---

    // Sitemap for SEO
    if (path === '/sitemap.xml' && req.method === 'GET') {
      const baseUrl = config.callbackUrl ? config.callbackUrl.replace('/auth/callback', '') : `https://${req.headers.host}`;
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${baseUrl}/login</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
</urlset>`;
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(sitemap);
    }

    // Robots.txt for SEO
    if (path === '/robots.txt' && req.method === 'GET') {
      const baseUrl = config.callbackUrl ? config.callbackUrl.replace('/auth/callback', '') : `https://${req.headers.host}`;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(`User-agent: *\nAllow: /login\nDisallow: /admin\nDisallow: /auth/\nDisallow: /api/\nSitemap: ${baseUrl}/sitemap.xml\n`);
    }

    // Dev auto-login (only when NODE_ENV !== 'production')
    if (path === '/dev/login' && req.method === 'GET' && process.env.NODE_ENV !== 'production') {
      const role = url.searchParams.get('role') || 'admin';
      const email = url.searchParams.get('email') || 'nick@acme.com';
      const groups = (url.searchParams.get('groups') || 'Engineering,DevOps').split(',');
      setSessionCookie(res, config.sessionSecret, {
        email,
        name: email.split('@')[0],
        provider: 'dev',
        role,
        profile: url.searchParams.get('profile') || null,
        groups
      }, isSecure(config));
      return redirect(res, '/');
    }

    // Login page
    if (path === '/login' && req.method === 'GET') {
      if (!rateLimiter.check(req, res)) return;
      const error = url.searchParams.get('error');
      const html = renderLoginPage(config, providers, error);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Auth initiation: /auth/:provider
    if (path.startsWith('/auth/') && path !== '/auth/callback' && req.method === 'GET') {
      if (!rateLimiter.check(req, res)) return;
      const providerName = path.split('/')[2];
      const provider = providers[providerName];
      if (!provider) {
        return redirect(res, '/login?error=Unknown+provider');
      }

      const stateData = { provider: providerName };

      // Marketplace: preserve selected profile
      const profile = url.searchParams.get('profile');
      if (profile) stateData.profile = profile;

      // Twitter PKCE
      if (providerName === 'twitter') {
        const pkce = generatePKCE();
        stateData.pkceVerifier = pkce.verifier;
        const csrf = setStateCookie(res, config.sessionSecret, stateData, isSecure(config));
        const authUrl = provider.getAuthUrl(csrf, pkce.challenge);
        return redirect(res, authUrl);
      }

      const csrf = setStateCookie(res, config.sessionSecret, stateData, isSecure(config));
      const authUrl = provider.getAuthUrl(csrf);
      return redirect(res, authUrl);
    }

    // Auth callback
    if (path === '/auth/callback' && req.method === 'GET') {
      if (!rateLimiter.check(req, res)) return;

      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');
      const errorParam = url.searchParams.get('error');

      if (errorParam) {
        return redirect(res, `/login?error=${encodeURIComponent(errorParam)}`);
      }

      if (!code || !stateParam) {
        return redirect(res, '/login?error=Missing+code+or+state');
      }

      const cookies = parseCookies(req.headers.cookie);
      const state = verifyState(config.sessionSecret, cookies[STATE_COOKIE], stateParam);
      if (!state) {
        return redirect(res, '/login?error=Invalid+state');
      }

      const provider = providers[state.provider];
      if (!provider) {
        return redirect(res, '/login?error=Unknown+provider');
      }

      try {
        const userInfo = state.provider === 'twitter'
          ? await provider.handleCallback(code, state.pkceVerifier)
          : await provider.handleCallback(code);

        // Resolve role or profile
        let role = null;
        let profile = null;

        // Determine sub-mode: in dual mode, state.profile presence signals marketplace flow
        const isEnterpriseFlow = config.mode === 'enterprise' ||
          (config.mode === 'dual' && !state.profile);
        const isMarketplaceFlow = config.mode === 'marketplace' ||
          (config.mode === 'dual' && !!state.profile);

        if (isEnterpriseFlow) {
          role = resolveRole(userInfo.groups, provider.roleMapping);
          if (!role) {
            return redirect(res, '/login?error=No+role+assigned');
          }
          if (!getUpstreamForRole(config, role)) {
            return redirect(res, `/login?error=No+upstream+for+role+${role}`);
          }
        } else if (isMarketplaceFlow) {
          profile = state.profile || getDefaultProfile(config);
          if (!profile || !getUpstreamForProfile(config, profile)) {
            return redirect(res, '/login?error=Invalid+profile');
          }
        }

        const sessionPayload = {
          email: userInfo.email,
          name: userInfo.name,
          provider: state.provider,
          role,
          profile,
          groups: userInfo.groups
        };

        setSessionCookie(res, config.sessionSecret, sessionPayload, isSecure(config));

        audit.log({
          user: userInfo.email,
          action: 'login',
          role: role || profile,
          provider: state.provider,
          ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
        });

        return redirect(res, '/');

      } catch (err) {
        console.error(`[auth] Callback error: ${err.message}`);
        return redirect(res, `/login?error=${encodeURIComponent('Authentication failed')}`);
      }
    }

    // Logout (POST only to prevent CSRF)
    if (path === '/logout' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      const session = verifySession(config.sessionSecret, cookies[SESSION_COOKIE]);

      if (session) {
        audit.log({
          user: session.email,
          action: 'logout',
          role: session.role || session.profile,
          ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
        });
      }

      clearCookies(res, isSecure(config));
      return redirect(res, '/login');
    }

    // Health check (cached)
    if (path === '/health' && req.method === 'GET') {
      const now = Date.now();
      if (healthCache.data && now < healthCache.expiresAt) {
        return json(res, healthCache.data);
      }

      const upstreams = {};
      let entries = [];
      if (config.mode === 'enterprise' || config.mode === 'dual') {
        entries = entries.concat(
          Object.entries(config.roles || {}).map(([k, v]) => [k, typeof v === 'string' ? v : v.upstream])
        );
      }
      if (config.mode === 'marketplace' || config.mode === 'dual') {
        entries = entries.concat(
          Object.entries(config.profiles || {}).map(([k, v]) => [k, v.upstream])
        );
      }

      await Promise.all(entries.map(async ([name, url]) => {
        upstreams[name] = await pingUpstream(url) ? 'up' : 'down';
      }));

      const data = {
        status: 'ok',
        mode: config.mode,
        providers: Object.keys(providers),
        upstreams
      };
      healthCache = { data, expiresAt: now + 5000 };
      return json(res, data);
    }

    // --- Authenticated routes ---

    const cookies = parseCookies(req.headers.cookie);
    let session = verifySession(config.sessionSecret, cookies[SESSION_COOKIE]);

    // devMode: auto-login with devUser if no session
    if (!session && config.devMode && config.devUser) {
      const dev = config.devUser;
      setSessionCookie(res, config.sessionSecret, {
        email: dev.email || 'admin@test.local',
        name: (dev.email || 'admin').split('@')[0],
        provider: 'dev',
        role: dev.role || 'admin',
        profile: dev.profile || null,
        groups: dev.groups || ['Engineering']
      }, isSecure(config));
      return redirect(res, path);
    }

    if (!session) {
      if (req.headers.accept?.includes('application/json') || path.startsWith('/api/') || path.startsWith('/admin/')) {
        return json(res, { error: 'Unauthorized' }, 401);
      }
      return redirect(res, '/login');
    }

    // --- Admin routes (admin role or in admins list) ---

    if (path === '/admin' && req.method === 'GET') {
      if (!isAdmin(config, session)) {
        return json(res, { error: 'Forbidden: admin access required' }, 403);
      }
      const profileData = (config.mode === 'enterprise' || config.mode === 'dual')
        ? listProfiles(config.roles)
        : {};
      const html = renderAdminPage(config, profileData, auditRecent, session);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (path === '/admin/api/config' && req.method === 'GET') {
      if (!isAdmin(config, session)) return json(res, { error: 'Forbidden' }, 403);
      // Return sanitized config (no secrets)
      const safe = {
        mode: config.mode,
        port: config.port,
        roles: (config.mode === 'enterprise' || config.mode === 'dual') ? config.roles : undefined,
        profiles: (config.mode === 'marketplace' || config.mode === 'dual') ? config.profiles : undefined,
        auth: config.auth?.map(a => ({ provider: a.provider, roleMapping: a.roleMapping })),
        admins: config.admins
      };
      return json(res, safe);
    }

    if (path.startsWith('/admin/api/profiles/') && req.method === 'POST') {
      if (!isAdmin(config, session)) return json(res, { error: 'Forbidden' }, 403);
      const profileName = path.split('/').pop();
      try {
        const body = await readBody(req);
        const { apiKey, model, profile, allow, deny } = JSON.parse(body);

        // Build tool config
        const toolConfig = {};
        if (profile) toolConfig.profile = profile;
        if (allow) toolConfig.allow = allow;
        if (deny) toolConfig.deny = deny;

        // Write tool config
        writeProfileToolConfig(profileName, toolConfig);

        // Write API key and model to OpenClaw profile config
        const patch = {};
        if (apiKey) {
          patch.auth = { anthropic: { apiKey } };
        }
        if (model) {
          patch.agents = { defaults: { model: { primary: model } } };
        }
        if (Object.keys(patch).length > 0) {
          writeProfileConfig(profileName, patch);
        }

        audit.log({
          user: session.email,
          action: 'admin_update_profile',
          role: profileName,
          ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
        });

        return json(res, { ok: true, profile: profileName });
      } catch (err) {
        return json(res, { ok: false, error: err.message }, 400);
      }
    }

    // --- Proxy routes ---

    const upstream = getUpstreamForSession(config, session);
    if (!upstream) {
      return json(res, { error: 'No upstream configured for your role/profile' }, 403);
    }

    // WebSocket routing — intercept /api/gateway/ws
    // This is handled in the upgrade handler, not here
    // For HTTP requests to /api/gateway/ws, return method not allowed
    if (path === '/api/gateway/ws') {
      return json(res, { error: 'WebSocket upgrade required' }, 426);
    }

    // Proxy everything else to Studio
    const studioUpstream = config.studioUpstream || 'http://127.0.0.1:3000';

    audit.log({
      user: session.email,
      action: 'proxy',
      role: session.role || session.profile,
      upstream: studioUpstream,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
    });

    // Inject floating gateway bar for all authenticated users
    const widget = getGatewayWidget(config, session);

    proxyHttp(req, res, studioUpstream, {
      'x-forwarded-user': session.email,
      'x-forwarded-role': session.role || '',
      'x-forwarded-groups': (session.groups || []).join(',')
    }, widget);
  }

  function getGatewayWidget(config, session) {
    const admin = isAdmin(config, session);
    const displayName = (session.name || session.email).replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const profileOrRole = (session.profile || session.role || '').replace(/'/g, "\\'");
    const hasApiKeyPlaceholder = (process.env.ANTHROPIC_API_KEY || '').includes('placeholder');
    const showApiKeyBanner = admin && hasApiKeyPlaceholder;
    const badgeClass = admin ? 'cg-badge-admin' : 'cg-badge-profile';
    const adminLinkHtml = admin
      ? '<a href="/admin" style="color:#58a6ff;text-decoration:none;font-weight:500;">Admin Panel</a>' : '';

    return `<script>(function(){
      var BAR_H = 38;
      var CG_CSS_ID = 'cg-styles';
      var CG_BAR_ID = 'cg-bar';
      var CG_BANNER_ID = 'cg-banner';
      var CG_ONBOARD_ID = 'cg-onboard';

      function injectStyles() {
        if (document.getElementById(CG_CSS_ID)) return;
        var s = document.createElement('style');
        s.id = CG_CSS_ID;
        s.textContent = '#cg-bar{position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0d0d0d;border-bottom:1px solid #222;padding:0 16px;display:flex!important;align-items:center;justify-content:space-between;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:13px;color:#aaa;height:'+BAR_H+'px;box-sizing:border-box;}'
          + '#cg-bar *{box-sizing:border-box;}'
          + '#cg-bar a{color:#58a6ff;text-decoration:none;font-weight:500;}'
          + '#cg-bar a:hover{text-decoration:underline;}'
          + '.cg-left,.cg-right{display:flex;align-items:center;gap:10px;}'
          + '.cg-brand{font-weight:700;color:#fff;font-size:13px;letter-spacing:-0.3px;}'
          + '.cg-sep{color:#333;}'
          + '.cg-user{color:#ccc;}'
          + '.cg-badge{padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;}'
          + '.cg-badge-profile{background:#0d2818;color:#3fb950;}'
          + '.cg-badge-admin{background:#5c1f1f;color:#ff7b72;}'
          + '.cg-logout{background:none;border:1px solid #333;color:#888;cursor:pointer;font-size:12px;font-family:inherit;padding:3px 10px;border-radius:6px;}'
          + '.cg-logout:hover{border-color:#555;color:#ccc;}'
          + '#cg-banner{position:fixed;top:'+BAR_H+'px;left:0;right:0;z-index:2147483646;background:#1a1400;border-bottom:1px solid #3d3000;color:#f0c000;padding:8px 16px;font-size:13px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;}'
          + '#cg-banner a{color:#58a6ff;}'
          + '#cg-onboard{position:fixed;left:0;right:0;z-index:2147483645;background:#0d1a2e;border-bottom:1px solid #1a3050;color:#7eb8f0;padding:8px 16px;font-size:13px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;}'
          + '#cg-onboard-close{cursor:pointer;margin-left:12px;color:#4a7aa8;font-size:16px;vertical-align:middle;}'
          + '#cg-onboard-close:hover{color:#fff;}';
        (document.head || document.documentElement).appendChild(s);
      }

      function injectBar() {
        if (document.getElementById(CG_BAR_ID)) return;
        var bar = document.createElement('div');
        bar.id = CG_BAR_ID;
        bar.innerHTML = '<div class="cg-left">'
          + '<span class="cg-brand">ClawGateway</span>'
          + '<span class="cg-sep">|</span>'
          + '<span class="cg-user">${displayName}</span>'
          + '<span class="cg-badge ${badgeClass}">${profileOrRole}</span>'
          + '</div>'
          + '<div class="cg-right">'
          + '${adminLinkHtml}'
          + '<form method="POST" action="/logout" style="margin:0;"><button type="submit" class="cg-logout">Logout</button></form>'
          + '</div>';
        document.documentElement.appendChild(bar);
      }

      function injectBanner() {
        ${showApiKeyBanner ? `
        if (document.getElementById(CG_BANNER_ID)) return;
        var b = document.createElement('div');
        b.id = CG_BANNER_ID;
        b.innerHTML = 'Set up your Anthropic API key in <a href="/admin">Admin Panel</a> to start chatting with your agents.';
        document.documentElement.appendChild(b);
        ` : ''}
      }

      function injectOnboard() {
        if (document.getElementById(CG_ONBOARD_ID)) return;
        if (localStorage.getItem('cg-onboard-dismissed')) return;
        var o = document.createElement('div');
        o.id = CG_ONBOARD_ID;
        o.style.top = ${showApiKeyBanner ? '(BAR_H + 37)' : 'BAR_H'} + 'px';
        o.innerHTML = 'Create AI agents, customize their personality, and share them with anyone. <span id="cg-onboard-close">&times;</span>';
        document.documentElement.appendChild(o);
        o.querySelector('#cg-onboard-close').onclick = function() {
          o.remove();
          localStorage.setItem('cg-onboard-dismissed', '1');
          applyOffset();
        };
      }

      function applyOffset() {
        var offset = BAR_H;
        ${showApiKeyBanner ? "if (document.getElementById(CG_BANNER_ID)) offset += 37;" : ""}
        if (document.getElementById(CG_ONBOARD_ID)) offset += 37;
        document.documentElement.style.setProperty('--cg-offset', offset + 'px');
        if (document.body) document.body.style.paddingTop = offset + 'px';
      }

      function inject() {
        injectStyles();
        injectBar();
        injectBanner();
        injectOnboard();
        applyOffset();
      }

      // Initial inject when DOM is ready
      if (document.body) inject();
      else document.addEventListener('DOMContentLoaded', inject);

      // Re-inject every 500ms if SPA removes our elements
      setInterval(function() {
        if (!document.getElementById(CG_BAR_ID)) inject();
      }, 500);

      // Also watch for body mutations (Next.js hydration)
      var obs = new MutationObserver(function() {
        if (!document.getElementById(CG_BAR_ID)) inject();
      });
      if (document.body) obs.observe(document.body, { childList: true });
      else document.addEventListener('DOMContentLoaded', function() {
        obs.observe(document.body, { childList: true });
      });
    })();</script>`;
  }

  // --- WebSocket upgrade handler ---
  function handleUpgrade(req, socket, head) {
    const config = getConfig();
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Only intercept /api/gateway/ws
    if (url.pathname === '/api/gateway/ws') {
      const cookies = parseCookies(req.headers.cookie);
      const session = verifySession(config.sessionSecret, cookies[SESSION_COOKIE]);

      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const upstream = getUpstreamForSession(config, session);
      if (!upstream) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      // Convert HTTP upstream URL to WebSocket URL for OpenClaw
      const wsUpstream = upstream.replace(/^http/, 'ws');

      audit.log({
        user: session.email,
        action: 'ws_connect',
        role: session.role || session.profile,
        upstream: wsUpstream,
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
      });

      socket.on('close', () => {
        audit.log({
          user: session.email,
          action: 'ws_disconnect',
          role: session.role || session.profile,
          upstream: wsUpstream
        });
      });

      const wsHeaders = {
        'x-forwarded-user': session.email,
        'x-forwarded-role': session.role || '',
        'x-forwarded-groups': (session.groups || []).join(',')
      };
      const token = getTokenForSession(config, session);
      if (token) {
        wsHeaders['Authorization'] = `Bearer ${token}`;
      }

      proxyWebSocket(req, socket, head, upstream, wsHeaders);
      return;
    }

    // Other WebSocket upgrades go to Studio
    const studioUpstream = config.studioUpstream || 'http://127.0.0.1:3000';
    const cookies = parseCookies(req.headers.cookie);
    const session = verifySession(config.sessionSecret, cookies[SESSION_COOKIE]);

    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    proxyWebSocket(req, socket, head, studioUpstream, {
      'x-forwarded-user': session.email,
      'x-forwarded-role': session.role || '',
      'x-forwarded-groups': (session.groups || []).join(',')
    });
  }

  return { handleRequest, handleUpgrade };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
