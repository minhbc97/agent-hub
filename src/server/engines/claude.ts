import { TERMINAL_KIND, type TerminalLine } from '../../shared/contracts.ts';
import { isRecord, parseJsonLine } from './json.ts';
import { EMPTY_USAGE, q, type EngineAdapter } from './types.ts';
import { mcpToolPrefix, removeMcpConfig, writeMcpConfig } from './claude-mcp.ts';

/**
 * Hard backstop for the preamble rule "never push, merge or rebase": a prompt rule can be lost when a long
 * session is compacted, a denied tool cannot.
 * shortcut: prefix rules miss forms like `git -C dir push` or a script that pushes; add a PreToolUse hook if that matters.
 */
const DENIED_TOOLS = ['Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)'];

/**
 * Lean start: without the user's plugins, skills, hooks and MCP servers, and with only the file and shell tools.
 * Measured on 2.1.329: the fixed prompt every model call carries drops from ~49k to ~9k tokens.
 */
const LEAN_ARGS = [
  '--strict-mcp-config',
  '--setting-sources',
  'project,local',
  '--tools',
  'Read,Write,Edit,Bash,Glob,Grep',
];

/** Messages go in and events come out as JSON lines; replayed messages tell the hub which ones Claude has read. */
const STREAM_ARGS = [
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--replay-user-messages',
];

/**
 * Claude Code headless: `claude -p` with STREAM_ARGS, prompt on stdin.
 * Verified on 2.1.329: JSONL events; the `result` one (not always last) has result, session_id, is_error,
 * total_cost_usd and usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}.
 */
export const claude: EngineAdapter = {
  command(agent, { resumeId, extraDirs }) {
    const parts = [agent.command.trim() || 'claude', '-p', ...STREAM_ARGS];
    if (agent.model) parts.push('--model', q(agent.model));
    if (resumeId) parts.push('--resume', q(resumeId));
    for (const d of extraDirs) parts.push('--add-dir', q(d));
    if (agent.isLean) parts.push(...LEAN_ARGS);
    // Picked servers are the user's explicit choice, so their tools run without a permission prompt headless
    // turns could not answer.
    const allowed = agent.allowedCommands.map((c) => q(`Bash(${c}:*)`));
    if (agent.isLean && agent.mcpServers.length) {
      parts.push('--mcp-config', q(writeMcpConfig(agent)));
      allowed.push(...agent.mcpServers.map(mcpToolPrefix));
    }
    if (allowed.length) parts.push('--allowedTools', ...allowed);
    parts.push('--disallowedTools', ...DENIED_TOOLS.map(q));
    if (agent.extraArgs.trim()) parts.push(agent.extraArgs.trim());
    return parts.join(' ');
  },

  afterTurn: removeMcpConfig,

  // Verified on 2.1.329: a message sent mid-turn is read after the running tool call and replayed with its uuid.
  live: {
    encode: (id, text) => `${JSON.stringify({ type: 'user', uuid: id, message: { role: 'user', content: text } })}\n`,
    readId: (event) => (event.isReplay === true && typeof event.uuid === 'string' ? event.uuid : undefined),
    isResult: (event) => event.type === 'result',
  },

  describe(event) {
    if (event.type === 'system' && event.subtype === 'init')
      return [{ kind: TERMINAL_KIND.start, text: String(event.model ?? '') }];
    const content = isRecord(event.message) ? event.message.content : undefined;
    return Array.isArray(content) ? content.filter(isRecord).flatMap(describeBlock) : [];
  },

  parse(stdout, stderr, exitCode) {
    const results = resultEvents(stdout);
    const last = results.at(-1);
    if (!last) {
      return {
        text: (stderr || stdout).trim() || `claude exited with code ${exitCode}`,
        sessionId: null,
        usage: EMPTY_USAGE,
        isError: true,
      };
    }
    const sum = (field: string) => results.reduce((total, r) => total + (usageOf(r)[field] ?? 0), 0);
    // usage sums every model call of the round; the last iteration is the context the session now carries.
    const context = (last.usage as { iterations?: Record<string, number>[] } | undefined)?.iterations?.at(-1);
    return {
      text: results
        .map((r) => String(r.result ?? ''))
        .filter(Boolean)
        .join('\n\n'),
      sessionId: (last.session_id as string) ?? null,
      usage: {
        inputTokens: sum('input_tokens'),
        outputTokens: sum('output_tokens'),
        cacheWriteTokens: sum('cache_creation_input_tokens'),
        cacheReadTokens: sum('cache_read_input_tokens'),
        // Unlike usage, the cost is the running total of the process.
        costUsd: Number(last.total_cost_usd ?? 0),
      },
      contextTokens: context
        ? (context.input_tokens ?? 0) +
          (context.cache_read_input_tokens ?? 0) +
          (context.cache_creation_input_tokens ?? 0)
        : undefined,
      isError: !!last.is_error || exitCode !== 0,
    };
  },
};

/** One per round: a message that arrives as the turn ends is answered in a round of its own. */
function resultEvents(stdout: string): Record<string, unknown>[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.includes('"result"'))
    .map(parseJsonLine)
    .filter((event) => event !== null)
    .filter((event) => event.type === 'result');
}

const usageOf = (event: Record<string, unknown>) => (event.usage ?? {}) as Record<string, number>;

const SHELL_TOOLS = ['Bash', 'PowerShell'];

function describeBlock(block: Record<string, unknown>): TerminalLine[] {
  if (block.type === 'text') return [{ kind: TERMINAL_KIND.text, text: String(block.text ?? '') }];
  if (block.type === 'thinking') return [{ kind: TERMINAL_KIND.thinking, text: String(block.thinking ?? '') }];
  if (block.type === 'tool_use' && SHELL_TOOLS.includes(String(block.name)))
    return [{ kind: TERMINAL_KIND.shell, text: toolTarget(block.input) }];
  if (block.type === 'tool_use')
    return [{ kind: TERMINAL_KIND.tool, text: `${String(block.name)} ${toolTarget(block.input)}` }];
  if (block.type === 'tool_result')
    return [{ kind: block.is_error ? TERMINAL_KIND.error : TERMINAL_KIND.output, text: resultText(block.content) }];
  return [];
}

/** The input that says what the call does; the whole input of an edit would bury it. */
const TARGET_FIELDS = ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description'];

function toolTarget(input: unknown): string {
  if (!isRecord(input)) return '';
  const target = TARGET_FIELDS.map((field) => input[field]).find((value) => typeof value === 'string');
  return typeof target === 'string' ? target : JSON.stringify(input);
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .map((part) => (typeof part.text === 'string' ? part.text : `[${String(part.type)}]`))
    .join('\n');
}
