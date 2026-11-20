#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV ??= 'production';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const serverEntry = fileURLToPath(new URL('../src/server/index.ts', import.meta.url));
// node:sqlite prints an ExperimentalWarning on Node 24 that reads like an error to end users.
// It goes in NODE_OPTIONS because tsx runs the server in its own child process.
const nodeOptions = [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ');
const server = spawn(process.execPath, [tsxCli, serverEntry, '--prod', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

server.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
