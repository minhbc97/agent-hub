import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TERMINAL_KIND, type TerminalLine } from '../../shared/contracts.ts';
import { isRecord, parseJsonLine } from './json.ts';
import { EMPTY_USAGE, q, type EngineAdapter } from './types.ts';

const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const CODEX_SESSIONS = join(CODEX_HOME, 'sessions');
const CODEX_CONFIG = join(CODEX_HOME, 'config.toml');

/** `[mcp_servers.<name>]` table headers; the name may be bare or quoted. */
const MCP_SERVER_HEADER = /^\s*\[\s*mcp_servers\.(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*\]/gm;

/**
 * MCP servers declared in Codex's config.toml. Servers a Codex plugin adds are left out: Codex rejects an
 * `enabled=false` override for them (verified on 0.164.0), so the hub could not switch them off.
 * shortcut: reads table headers only, misses servers written as inline tables; parse TOML if users hit that.
 */
export function codexMcpServers(toml = readConfig()): string[] {
  return [...toml.matchAll(MCP_SERVER_HEADER)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function readConfig(): string {
  try {
    return readFileSync(CODEX_CONFIG, 'utf8');
  } catch {
    return '';
  }
}

/** With servers picked, every other configured one is switched off for the turn; none picked keeps them all. */
export function codexMcpArgs(picked: string[], configured = codexMcpServers()): string[] {
  if (!picked.length) return [];
  return configured
    .filter((name) => !picked.includes(name))
    .flatMap((name) => ['-c', q(`mcp_servers.${/^[\w-]+$/.test(name) ? name : JSON.stringify(name)}.enabled=false`)]);
}

/**
 * Codex headless: `codex exec --json ... -`, prompt on stdin, JSONL events on stdout (verified on 0.164.0).
 * `exec resume` rejects --sandbox/--add-dir, so writable dirs go through `-c`, which both forms accept.
 */
export const codex: EngineAdapter = {
  cumulativeUsage: true,
  // Codex keeps running after the turn while a shell command it started still hangs (seen with its Windows sandbox).
  isTurnOver: (stdout) => /"type":"turn\.(completed|failed)"/.test(stdout),

  command(agent, { resumeId, extraDirs }) {
    const parts = [agent.command.trim() || 'codex', 'exec', '--json', '--skip-git-repo-check'];
    if (agent.model) parts.push('-m', q(agent.model));
    // TOML literal strings ('...') keep Windows backslashes as-is.
    if (extraDirs.length)
      parts.push('-c', q(`sandbox_workspace_write.writable_roots=[${extraDirs.map((d) => `'${d}'`).join(',')}]`));
    parts.push(...codexMcpArgs(agent.mcpServers));
    if (agent.extraArgs.trim()) parts.push(agent.extraArgs.trim());
    if (resumeId) parts.push('resume', q(resumeId));
    parts.push('-');
    return parts.join(' ');
  },

  describe(event) {
    if (event.type === 'thread.started') return [{ kind: TERMINAL_KIND.start, text: '' }];
    if (event.type === 'turn.failed' || event.type === 'error')
      return [{ kind: TERMINAL_KIND.error, text: errorText(event) }];
    if (!isRecord(event.item)) return [];
    if (event.type === 'item.started') return describeStart(event.item);
    return event.type === 'item.completed' ? describeEnd(event.item) : [];
  },

  parse(stdout, stderr, exitCode) {
    let text = '';
    let error = '';
    let sessionId: string | null = null;
    let usage = EMPTY_USAGE;
    for (const line of stdout.split(/\r?\n/)) {
      const event = parseJsonLine(line);
      if (!event) continue;
      const item = event.item as Record<string, unknown> | undefined;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') sessionId = event.thread_id;
      else if (event.type === 'item.completed' && item?.type === 'agent_message') text = String(item.text ?? '');
      else if (event.type === 'turn.completed') usage = toUsage(event.usage);
      else if (event.type === 'turn.failed' || event.type === 'error') error = errorText(event) || error;
    }
    const isError = exitCode !== 0 || !!error;
    return {
      text: text || error || stderr.trim() || (isError ? `codex exited with code ${exitCode}` : ''),
      sessionId,
      usage,
      contextTokens: sessionId ? rolloutContext(sessionId) : undefined,
      isError,
    };
  },
};

/** Codex counts cached input inside input_tokens; split it out so cache reads are reported separately. */
function toUsage(raw: unknown) {
  const u = (raw ?? {}) as Record<string, number>;
  const cached = u.cached_input_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (u.input_tokens ?? 0) - cached),
    outputTokens: u.output_tokens ?? 0,
    cacheWriteTokens: u.cache_write_input_tokens ?? 0,
    cacheReadTokens: cached,
    costUsd: 0,
  };
}

function errorText(event: Record<string, unknown>): string {
  const err = event.error as Record<string, unknown> | undefined;
  return String(err?.message ?? event.message ?? '');
}

/**
 * `exec --json` only reports usage summed over the turn, but Codex's own rollout log records each model call;
 * the last call's input (cached part included) is the context the thread now carries.
 * shortcut: scans the whole sessions tree each turn; index rollouts by thread id if that ever gets slow.
 */
export function rolloutContext(threadId: string, sessionsDir = CODEX_SESSIONS): number | undefined {
  if (!existsSync(sessionsDir)) return undefined;
  const file = readdirSync(sessionsDir, { recursive: true, encoding: 'utf8' }).find((f) =>
    f.endsWith(`${threadId}.jsonl`),
  );
  if (!file) return undefined;
  const lines = readFileSync(join(sessionsDir, file), 'utf8').split(/\r?\n/).reverse();
  for (const line of lines) {
    if (!line.includes('"token_count"')) continue;
    // {"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{...}}}} (verified on 0.164.0)
    const payload = parseJsonLine(line)?.payload as
      { info?: { last_token_usage?: { input_tokens?: number } } } | undefined;
    const last = payload?.info?.last_token_usage;
    if (typeof last?.input_tokens === 'number') return last.input_tokens;
  }
  return undefined;
}

function describeStart(item: Record<string, unknown>): TerminalLine[] {
  if (item.type === 'command_execution') return [{ kind: TERMINAL_KIND.shell, text: String(item.command ?? '') }];
  if (item.type === 'mcp_tool_call')
    return [{ kind: TERMINAL_KIND.tool, text: `${String(item.server)} ${String(item.tool)}` }];
  return [];
}

function describeEnd(item: Record<string, unknown>): TerminalLine[] {
  switch (item.type) {
    case 'agent_message':
      return [{ kind: TERMINAL_KIND.text, text: String(item.text ?? '') }];
    case 'reasoning':
      return [{ kind: TERMINAL_KIND.thinking, text: String(item.text ?? '') }];
    case 'command_execution':
      return [
        {
          kind: item.exit_code ? TERMINAL_KIND.error : TERMINAL_KIND.output,
          text: String(item.aggregated_output ?? ''),
        },
      ];
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
      return changes.map((c) => ({ kind: TERMINAL_KIND.tool, text: `${String(c.kind)} ${String(c.path)}` }));
    }
    case 'web_search':
      return [{ kind: TERMINAL_KIND.tool, text: `web_search ${String(item.query ?? '')}` }];
    case 'mcp_tool_call':
      return isRecord(item.error) ? [{ kind: TERMINAL_KIND.error, text: String(item.error.message ?? '') }] : [];
    case 'error':
      return [{ kind: TERMINAL_KIND.error, text: String(item.message ?? '') }];
    default:
      return [];
  }
}
