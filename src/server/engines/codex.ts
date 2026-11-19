import { EMPTY_USAGE, q, type EngineAdapter } from './types.ts';

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
