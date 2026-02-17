#!/usr/bin/env node

import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startGateway } from '../src/index.mjs';

function usage() {
  console.log(`
  Usage: clawgateway --config <path> [--port <number>]

  Options:
    --config <path>   Path to gateway.json config file (required unless GATEWAY_CONFIG env is set)
    --port <number>   Override port from config
    --help            Show this help message

  Environment:
    GATEWAY_CONFIG    JSON string of the config (writes to /tmp/gateway.json)
  `);
}

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      result.config = resolve(args[++i]);
    } else if (args[i] === '--port' && args[i + 1]) {
      result.port = parseInt(args[++i], 10);
    } else if (args[i] === '--help') {
      result.help = true;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  usage();
  process.exit(0);
}

// Support GATEWAY_CONFIG env var: write JSON to a temp file
if (!args.config && process.env.GATEWAY_CONFIG) {
  const tmpPath = '/tmp/gateway.json';
  writeFileSync(tmpPath, process.env.GATEWAY_CONFIG, 'utf-8');
  args.config = tmpPath;
  console.log('[config] Loaded config from GATEWAY_CONFIG env var');
}

if (!args.config) {
  console.error('  Error: --config <path> or GATEWAY_CONFIG env var is required\n');
  usage();
  process.exit(1);
}

// Railway sets PORT env var — use it as override if --port not given
const port = args.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : undefined);

try {
  await startGateway(args.config, port);
} catch (err) {
  console.error(`  Failed to start: ${err.message}`);
  process.exit(1);
}
