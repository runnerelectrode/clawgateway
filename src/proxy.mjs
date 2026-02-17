import http from 'node:http';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
  'proxy-connection'
]);

function stripHopHeaders(headers) {
  const out = {};
  for (const [key, val] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      out[key] = val;
    }
  }
  return out;
}

export function proxyHttp(req, res, upstreamUrl, extraHeaders = {}, injectHtml = '') {
  const upstream = new URL(upstreamUrl);
  const target = new URL(req.url, upstreamUrl);

  const headers = {
    ...stripHopHeaders(req.headers),
    ...extraHeaders,
    host: upstream.host
  };

  const proxyReq = http.request({
    hostname: upstream.hostname,
    port: upstream.port || 80,
    path: target.pathname + target.search,
    method: req.method,
    headers
  }, (proxyRes) => {
    const resHeaders = stripHopHeaders(proxyRes.headers);
    const isHtml = (resHeaders['content-type'] || '').includes('text/html');

    // If injecting HTML, remove content-length (we're adding bytes)
    if (injectHtml && isHtml) {
      delete resHeaders['content-length'];
    }

    res.writeHead(proxyRes.statusCode, resHeaders);

    if (injectHtml && isHtml) {
      proxyRes.pipe(res, { end: false });
      proxyRes.on('end', () => {
        res.end(injectHtml);
      });
    } else {
      proxyRes.pipe(res, { end: true });
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] HTTP error to ${upstreamUrl}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Gateway', upstream: upstreamUrl }));
    }
  });

  req.pipe(proxyReq, { end: true });
}

export function proxyWebSocket(req, socket, head, upstreamUrl, extraHeaders = {}) {
  const upstream = new URL(upstreamUrl);
  const target = new URL(req.url, upstreamUrl);

  const headers = {
    ...stripHopHeaders(req.headers),
    ...extraHeaders,
    host: upstream.host,
    origin: `http://${upstream.host}`,
    connection: 'Upgrade',
    upgrade: 'websocket'
  };

  const proxyReq = http.request({
    hostname: upstream.hostname,
    port: upstream.port || 80,
    path: target.pathname + target.search,
    method: 'GET',
    headers
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    // Write the HTTP 101 response back to the client
    const statusLine = `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
    const headerLines = Object.entries(proxyRes.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    socket.write(statusLine + headerLines + '\r\n\r\n');

    if (proxyHead.length > 0) socket.write(proxyHead);

    // Bidirectional pipe
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
    proxySocket.on('close', () => socket.destroy());
    socket.on('close', () => proxySocket.destroy());
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] WebSocket error to ${upstreamUrl}: ${err.message}`);
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  });

  proxyReq.end();
}

// Lightweight upstream health check (HTTP HEAD)
export function pingUpstream(upstreamUrl, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const upstream = new URL(upstreamUrl);
    const req = http.request({
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: '/',
      method: 'HEAD',
      timeout: timeoutMs
    }, (res) => {
      res.resume(); // drain
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
