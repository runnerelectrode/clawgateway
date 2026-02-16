import https from 'node:https';
import http from 'node:http';

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.request(parsed, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Non-JSON response from ${url}: ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error(`Request to ${url} timed out`));
    });

    if (body) req.write(body);
    req.end();
  });
}

export function httpsPost(url, body, headers = {}) {
  return request(url, { method: 'POST', headers }, body);
}

export function httpsGet(url, headers = {}) {
  return request(url, { method: 'GET', headers });
}
