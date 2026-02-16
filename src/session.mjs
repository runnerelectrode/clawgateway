import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'clawgateway_session';
export const STATE_COOKIE = 'clawgateway_state';

function base64url(buf) {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function hmac(secret, data) {
  return createHmac('sha256', secret).update(data).digest();
}

// --- Session cookie ---

export function createSession(secret, payload) {
  const data = {
    ...payload,
    exp: Date.now() + 8 * 60 * 60 * 1000 // 8 hours
  };
  const encoded = base64url(JSON.stringify(data));
  const sig = base64url(hmac(secret, encoded));
  return `${encoded}.${sig}`;
}

export function verifySession(secret, cookie) {
  if (!cookie || typeof cookie !== 'string') return null;
  const dotIdx = cookie.lastIndexOf('.');
  if (dotIdx === -1) return null;

  const encoded = cookie.slice(0, dotIdx);
  const sig = cookie.slice(dotIdx + 1);

  const expected = base64url(hmac(secret, encoded));
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);

  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(base64urlDecode(encoded));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- State cookie (OAuth CSRF + provider + PKCE + profile) ---

export function createState(secret, data) {
  const csrf = randomBytes(32).toString('hex');
  const payload = { csrf, ...data };
  const encoded = base64url(JSON.stringify(payload));
  const sig = base64url(hmac(secret, encoded));
  return { csrf, cookie: `${encoded}.${sig}` };
}

export function verifyState(secret, cookie, csrfParam) {
  const payload = verifySession(secret, cookie); // same format
  if (!payload) return null;
  if (payload.csrf !== csrfParam) return null;
  return payload;
}

// --- Cookie parsing + setting ---

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = decodeURIComponent(pair.slice(eqIdx + 1).trim());
    cookies[key] = val;
  }
  return cookies;
}

export function setSessionCookie(res, secret, payload, isSecure) {
  const value = createSession(secret, payload);
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=28800'
  ];
  if (isSecure) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

export function setStateCookie(res, secret, data, isSecure) {
  const { csrf, cookie } = createState(secret, data);
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(cookie)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=600' // 10 min for OAuth flow
  ];
  if (isSecure) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
  return csrf;
}

export function clearCookies(res, isSecure) {
  for (const name of [SESSION_COOKIE, STATE_COOKIE]) {
    const parts = [
      `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    ];
    if (isSecure) parts[0] += '; Secure';
    appendSetCookie(res, parts[0]);
  }
}

function appendSetCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [existing];
    res.setHeader('Set-Cookie', [...arr, value]);
  } else {
    res.setHeader('Set-Cookie', value);
  }
}
