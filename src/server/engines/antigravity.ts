import { EMPTY_USAGE, q, type EngineAdapter } from './types.ts';

/** Antigravity stream-json accepts prompts on stdin and resumes by conversation id. */
export const antigravity: EngineAdapter = {
  cumulativeUsage: true,
  formatInput: (prompt) => `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`,
  isTurnOver: (stdout) => stdout.split(/\r?\n/).some((line) => parseLine(line)?.event === 'result'),

  command(agent, { resumeId, extraDirs }) {
    const parts = [agent.command.trim() || 'agy', '--input-format', 'stream-json', '--output-format', 'stream-json'];
    if (agent.model) parts.push('--model', q(agent.model));
    if (resumeId) parts.push('--conversation', q(resumeId));
    for (const dir of extraDirs) parts.push('--add-dir', q(dir));
    if (agent.extraArgs.trim()) parts.push(agent.extraArgs.trim());
    return parts.join(' ');
  },

  parse(stdout, stderr, exitCode) {
    let result: Record<string, unknown> | null = null;
    for (const line of stdout.split(/\r?\n/)) {
      const event = parseLine(line);
      if (event?.event === 'result' && isRecord(event.result)) result = event.result;
    }
    if (!result) {
      return {
        text: stderr.trim() || stdout.trim() || `agy exited with code ${exitCode}`,
        sessionId: null,
        usage: EMPTY_USAGE,
        isError: true,
      };
    }
    const status = String(result.status ?? '');
    return {
      text: String(result.response ?? result.error ?? stderr.trim()),
      sessionId: typeof result.conversation_id === 'string' ? result.conversation_id : null,
      usage: toUsage(result.usage),
      isError: status !== 'SUCCESS' || exitCode !== 0,
    };
  },
};

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toUsage(raw: unknown) {
  const usage = isRecord(raw) ? raw : {};
  return {
    inputTokens: numberValue(usage.input_tokens),
    // Antigravity reports thinking_tokens as a breakdown within output_tokens.
    outputTokens: numberValue(usage.output_tokens),
    cacheWriteTokens: 0,
    cacheReadTokens: numberValue(usage.cache_read_tokens),
    costUsd: 0,
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
