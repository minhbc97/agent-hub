import { EMPTY_USAGE, q, type EngineAdapter } from './types.ts';

/**
 * Hard backstop for the preamble rule "never push, merge or rebase": a prompt rule can be lost when a long
 * session is compacted, a denied tool cannot.
 * shortcut: prefix rules miss forms like `git -C dir push` or a script that pushes; add a PreToolUse hook if that matters.
 */
const DENIED_TOOLS = ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)'];

/**
 * Claude Code headless: `claude -p --output-format json`, prompt on stdin.
 * Verified on 2.1.328: one JSON object with result, session_id, is_error, total_cost_usd and
 * usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}.
 */
export const claude: EngineAdapter = {
  command(agent, { resumeId, extraDirs }) {
    const parts = [agent.command.trim() || 'claude', '-p', '--output-format', 'json'];
    if (agent.model) parts.push('--model', q(agent.model));
    if (resumeId) parts.push('--resume', q(resumeId));
    for (const d of extraDirs) parts.push('--add-dir', q(d));
    parts.push('--disallowedTools', ...DENIED_TOOLS.map(q));
    if (agent.extraArgs.trim()) parts.push(agent.extraArgs.trim());
    return parts.join(' ');
  },

  parse(stdout, stderr, exitCode) {
    const json = lastJsonObject(stdout);
    if (!json) {
      return {
        text: (stderr || stdout).trim() || `claude exited with code ${exitCode}`,
        sessionId: null,
        usage: EMPTY_USAGE,
        isError: true,
      };
    }
    const u = (json.usage ?? {}) as Record<string, number>;
    return {
      text: String(json.result ?? ''),
      sessionId: (json.session_id as string) ?? null,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        costUsd: Number(json.total_cost_usd ?? 0),
      },
      isError: !!json.is_error || exitCode !== 0,
    };
  },
};

function lastJsonObject(out: string): Record<string, unknown> | null {
  const lines = out.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      return JSON.parse(s);
    } catch {
      /* keep looking */
    }
  }
  return null;
}
