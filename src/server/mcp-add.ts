import { spawn } from 'node:child_process';
import { ENGINE, MCP_TRANSPORT, type Engine, type McpServerInput } from '../shared/contracts.ts';
import { DomainError } from './domain-error.ts';
import { engineDefaults } from './engines/catalog.ts';
import { claudeMcpServers } from './engines/claude-mcp.ts';
import { codexMcpServers } from './engines/codex.ts';
import { OPENROUTER_API_KEY_ENV } from './engines/openrouter.ts';
import { q } from './engines/types.ts';
import { killTree } from './runner.ts';
import { redact } from './terminal.ts';

const ADD_TIMEOUT_MS = 60_000;
const MAX_ERROR_DETAIL = 500;
/**
 * Verified on 0.164.0: after saving an http server Codex starts its OAuth login and waits for the browser.
 * The server is saved once this line is out, so the hub ends the wait and the user signs in later.
 */
const CODEX_SAVED = /Added global MCP server/;

/** Arguments for `<cli> mcp add`, at user level so every agent of that CLI can pick the server. */
export function mcpAddArgs(engine: Engine, server: McpServerInput): string[] {
  const { name, url, command, args, env } = server;
  const isHttp = server.transport === MCP_TRANSPORT.http;
  const pairs = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  if (engine === ENGINE.codex)
    return isHttp
      ? ['mcp', 'add', name, '--url', url]
      : ['mcp', 'add', name, ...pairs.flatMap((pair) => ['--env', pair]), '--', command, ...args];
  return isHttp
    ? ['mcp', 'add', '--scope', 'user', '--transport', 'http', name, url]
    : ['mcp', 'add', '--scope', 'user', name, ...pairs.flatMap((pair) => ['-e', pair]), '--', command, ...args];
}

const installedNames = (engine: Engine) =>
  engine === ENGINE.codex ? codexMcpServers() : Object.keys(claudeMcpServers());

/** Adds the server to each picked CLI's own config; the hub keeps no copy of it. */
export async function addMcpServer(server: McpServerInput): Promise<void> {
  const taken = server.engines.find((engine) => installedNames(engine).includes(server.name));
  if (taken) throw new DomainError('errors.mcpServerExists', { name: server.name, engine: taken });
  for (const engine of server.engines) await runAdd(engine, server);
}

function runAdd(engine: Engine, server: McpServerInput): Promise<void> {
  const cmd = [engineDefaults(engine).defaultCommand, ...mcpAddArgs(engine, server).map(q)].join(' ');
  const env = { ...process.env };
  delete env[OPENROUTER_API_KEY_ENV];
  return new Promise((resolve, reject) => {
    // A shell, because the CLIs are .cmd shims on Windows; validation keeps shell syntax out of the values.
    const child = spawn(cmd, {
      shell: true,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let isSaved = false;
    const timer = setTimeout(() => killTree(child.pid), ADD_TIMEOUT_MS);
    const onOutput = (chunk: Buffer) => {
      output += chunk.toString();
      if (engine === ENGINE.codex && !isSaved && CODEX_SAVED.test(output)) {
        isSaved = true;
        killTree(child.pid);
      }
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(addFailed(engine, error.message, server));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || isSaved) resolve();
      else reject(addFailed(engine, output, server));
    });
  });
}

/** The CLI's own message, without the env values the user typed (a CLI may echo them back). */
function addFailed(engine: Engine, output: string, server: McpServerInput): DomainError {
  let detail = redact(output).trim();
  for (const value of Object.values(server.env)) if (value) detail = detail.replaceAll(value, '***');
  return new DomainError('errors.mcpAddFailed', { engine, detail: detail.slice(-MAX_ERROR_DETAIL) });
}
