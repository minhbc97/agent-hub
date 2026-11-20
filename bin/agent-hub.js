#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV ??= 'production';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const serverEntry = fileURLToPath(new URL('../src/server/index.ts', import.meta.url));
const server = spawn(process.execPath, [tsxCli, serverEntry, '--prod', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

server.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
