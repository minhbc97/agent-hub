import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_USAGE, q, type EngineAdapter } from './types.ts';

const CODEX_SESSIONS = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');

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
    if (agent.extraArgs.trim()) parts.push(agent.extraArgs.trim());
    if (resumeId) parts.push('resume', q(resumeId));
    parts.push('-');
    return parts.join(' ');
  },

  parse(stdout, stderr, exitCode) {
    let text = '';
    let error = '';
    let sessionId: string | null = null;
    let usage = EMPTY_USAGE;
    for (const line of stdout.split(/\r?\n/)) {
      const event = parseLine(line);
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

function parseLine(line: string): Record<string, unknown> | null {
  const s = line.trim();
  if (!s.startsWith('{')) return null;
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

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
    const payload = parseLine(line)?.payload as { info?: { last_token_usage?: { input_tokens?: number } } } | undefined;
    const last = payload?.info?.last_token_usage;
    if (typeof last?.input_tokens === 'number') return last.input_tokens;
  }
  return undefined;
}
