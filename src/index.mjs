import http from 'node:http';
import { createConfigManager } from './config.mjs';
import { createProviders } from './auth/index.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { createAuditLogger } from './audit.mjs';
import { createRouter } from './router.mjs';

export async function startGateway(configPath, portOverride) {
  const configManager = createConfigManager(configPath);
  const config = configManager.getConfig();

  const port = portOverride || config.port || 8422;

  // Create auth providers
  const providers = createProviders(config.auth, config.callbackUrl);

  // Create rate limiter
  const rateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10
  });

  // Create audit logger
  const audit = createAuditLogger(config.auditLog);

  // Create router
  const { handleRequest, handleUpgrade } = createRouter({
    getConfig: configManager.getConfig,
    saveConfig: configManager.saveConfig,
    providers,
    rateLimiter,
    audit
  });

  // Create server
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(`[server] Unhandled error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    });
  });

  server.on('upgrade', handleUpgrade);

  // Start listening
  server.listen(port, () => {
    const mode = config.mode || 'enterprise';
    console.log('');
    console.log('  ClawGateway v0.1.0');
    console.log(`  Mode:       ${mode}`);
    console.log(`  Providers:  ${Object.values(providers).map(p => p.displayName).join(', ')}`);
    console.log(`  Studio:     ${config.studioUpstream || 'http://127.0.0.1:3000'}`);
    console.log(`  Port:       ${port}`);
    console.log('  Routes:');

    if (mode === 'enterprise' || mode === 'dual') {
      if (mode === 'dual') console.log('  Enterprise Routes:');
      for (const [role, val] of Object.entries(config.roles || {})) {
        const url = typeof val === 'string' ? val : val.upstream;
        console.log(`    ${role.padEnd(12)} → ${url}`);
      }
    }
    if (mode === 'marketplace' || mode === 'dual') {
      if (mode === 'dual') console.log('  Marketplace Profiles:');
      for (const [name, p] of Object.entries(config.profiles || {})) {
        console.log(`    ${name.padEnd(20)} → ${p.upstream}${p.default ? ' (default)' : ''}`);
      }
    }
    console.log('');
  });

  // Graceful shutdown
  function shutdown() {
    console.log('\n  Shutting down...');
    server.close(() => {
      configManager.close();
      rateLimiter.close();
      audit.close();
      process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
