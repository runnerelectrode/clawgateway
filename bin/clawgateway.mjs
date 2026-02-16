#!/usr/bin/env node

import { resolve } from 'node:path';
import { startGateway } from '../src/index.mjs';

function usage() {
  console.log(`
  Usage: clawgateway --config <path> [--port <number>]

  Options:
    --config <path>   Path to gateway.json config file (required)
    --port <number>   Override port from config
    --help            Show this help message
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

if (!args.config) {
  console.error('  Error: --config <path> is required\n');
  usage();
  process.exit(1);
}

try {
  await startGateway(args.config, args.port);
} catch (err) {
  console.error(`  Failed to start: ${err.message}`);
  process.exit(1);
}
