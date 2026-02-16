const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 10;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

export function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs || DEFAULT_WINDOW_MS;
  const maxRequests = opts.maxRequests || DEFAULT_MAX_REQUESTS;
  const hits = new Map();

  // Periodic cleanup of expired entries
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.resetAt) hits.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
  }

  return {
    /**
     * Returns true if request is allowed, false if rate limited.
     * If rate limited, sends 429 response.
     */
    check(req, res) {
      const ip = getClientIp(req);
      const now = Date.now();
      let entry = hits.get(ip);

      if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(ip, entry);
      }

      entry.count++;

      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter)
        });
        res.end(JSON.stringify({ error: 'Too many requests', retryAfter }));
        return false;
      }

      return true;
    },

    close() {
      clearInterval(cleanupTimer);
    }
  };
}
