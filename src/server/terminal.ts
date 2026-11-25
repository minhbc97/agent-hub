import { stripVTControlCharacters } from 'node:util';
import {
  RUN_STATUS,
  TERMINAL_KIND,
  TERMINAL_MAX_ENTRIES,
  type RunStatus,
  type TerminalLine,
  type TerminalOutput,
} from '../shared/contracts.ts';
import { listRuns, type Agent, type Run } from './db.ts';
import { parseJsonLine } from './engines/json.ts';
import type { EngineAdapter } from './engines/index.ts';
import { emit } from './events.ts';
import { lineReader } from './lines.ts';

const MAX_ENTRY_CHARS = 4_000;
/** Redaction runs on more than is shown, so the cut never leaves half a secret too short to be recognized. */
const MAX_REDACT_CHARS = MAX_ENTRY_CHARS * 2;
/** Output arrives in many small chunks; open pages are told at most this often. */
const NOTIFY_INTERVAL_MS = 300;

const REDACTED = '[redacted]';
const SECRET_ENV_NAME = /key|token|secret|passw|credential/i;
const MIN_SECRET_ENV_LENGTH = 8;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
/** Tokens recognizable by their own shape: Anthropic, OpenAI, Stripe, GitHub, GitLab, npm, Slack, AWS, Google, JWT. */
const TOKEN =
  /\b(?:[sr]k[-_][\w-]{16,}|gh[pousr]_\w{16,}|github_pat_\w{16,}|glpat-[\w-]{16,}|npm_\w{16,}|xox[a-z]-[\w-]{10,}|A[KS]IA[A-Z0-9]{16}|AIza[\w-]{30,}|ya29\.[\w-]{10,}|eyJ[\w-]{8,}\.[\w-]{8,}(?:\.[\w-]*)?)/g;
/** A long bare base64 line is how a key body looks when it is printed line by line. */
const BASE64_LINE = /^[A-Za-z0-9+/]{60,}={0,2}$/gm;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi;
const URL_PASSWORD = /(:\/\/[^\s:/@]{0,100}:)[^\s@/]{1,200}@/g;
/** `FOO=bar` lines, as printed by `cat .env` or a file read with line numbers: hidden whatever the name. */
const ENV_LINE = /^(\s*(?:\d+[\t→])?\s*(?:export\s+|set\s+)?[A-Z][A-Z0-9_]{2,60}=)\S.*$/gm;
const NAMED_SECRET =
  /((?:passw(?:or)?d|passphrase|pwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|credentials?)\\?["']?\s{0,3}[:=]\s{0,3}\\?["']?)[^\s"',;\\]{4,}/gi;

/** Hide credentials an agent printed. Best effort by shape and name: a secret that looks like prose gets through. */
export function redact(text: string): string {
  let safe = text.replace(PRIVATE_KEY, REDACTED);
  for (const [name, value] of Object.entries(process.env))
    if (value && value.length >= MIN_SECRET_ENV_LENGTH && SECRET_ENV_NAME.test(name))
      safe = safe.replaceAll(value, REDACTED);
  return safe
    .replace(BASE64_LINE, REDACTED)
    .replace(ENV_LINE, `$1${REDACTED}`)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
    .replace(TOKEN, REDACTED)
    .replace(URL_PASSWORD, `$1${REDACTED}@`)
    .replace(NAMED_SECRET, `$1${REDACTED}`);
}

/**
 * The latest turn of each agent.
 * shortcut: memory only; after a hub restart just the turn's saved answer is left. Store it if that matters.
 */
const terminals = new Map<string, TerminalOutput>();

export interface TerminalWriter {
  cwd(path: string): void;
  /** A message handed over while the turn runs. */
  input(text: string): void;
  stdout(chunk: string): void;
  stderr(chunk: string): void;
  end(status: RunStatus, error: string): void;
}

/** Start collecting the output of `run`, replacing that of the agent's previous turn; `input` is what it was told. */
export function openTerminal(
  agent: Agent,
  run: Run,
  input: string[],
  describe: EngineAdapter['describe'],
): TerminalWriter {
  const terminal: TerminalOutput = {
    runId: run.id,
    status: RUN_STATUS.running,
    cwd: '',
    startedAt: run.startedAt,
    endedAt: null,
    droppedEntries: 0,
    entries: [],
  };
  terminals.set(agent.id, terminal);
  let seq = 0;
  let timer: NodeJS.Timeout | undefined;
  const notify = () => {
    timer = undefined;
    emit({ type: 'terminal', workspaceId: agent.workspaceId, id: agent.id });
  };
  const add = ({ kind, text: raw }: TerminalLine) => {
    const text = toText(raw);
    if (!text && kind !== TERMINAL_KIND.start) return;
    terminal.entries.push({ seq: ++seq, at: new Date().toISOString(), kind, text });
    if (terminal.entries.length > TERMINAL_MAX_ENTRIES) {
      terminal.entries.shift();
      terminal.droppedEntries++;
    }
    timer ??= setTimeout(notify, NOTIFY_INTERVAL_MS);
  };
  const stdout = lineReader((line) => {
    const event = describe && parseJsonLine(line);
    if (event) describe(event).forEach(add);
    else add({ kind: TERMINAL_KIND.text, text: line });
  });
  const stderr = lineReader((line) => add({ kind: TERMINAL_KIND.error, text: line }));
  for (const text of input) add({ kind: TERMINAL_KIND.input, text });
  notify();
  return {
    cwd(path) {
      terminal.cwd = path;
    },
    input(text) {
      add({ kind: TERMINAL_KIND.input, text });
    },
    stdout: stdout.push,
    stderr: stderr.push,
    end(status, error) {
      stdout.flush();
      stderr.flush();
      // The CLI often printed the failure itself already.
      if (terminal.entries.at(-1)?.text !== toText(error)) add({ kind: TERMINAL_KIND.error, text: error });
      terminal.status = status;
      terminal.endedAt = run.endedAt;
      clearTimeout(timer);
      notify();
    },
  };
}

/** Output of the agent's current or last turn; only what came after `afterSeq` when the reader already has `runId`. */
export function terminalOutput(agentId: string, runId: string, afterSeq: number): TerminalOutput {
  const terminal = terminals.get(agentId) ?? savedOutput(agentId);
  if (terminal.runId !== runId) return terminal;
  return { ...terminal, entries: terminal.entries.filter((entry) => entry.seq > afterSeq) };
}

function savedOutput(agentId: string): TerminalOutput {
  const run = listRuns(agentId, 1)[0];
  if (!run)
    return { runId: null, status: null, cwd: '', startedAt: null, endedAt: null, droppedEntries: 0, entries: [] };
  const kind = run.status === RUN_STATUS.failed ? TERMINAL_KIND.error : TERMINAL_KIND.text;
  return {
    runId: run.id,
    status: run.status,
    cwd: '',
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    droppedEntries: 0,
    entries: run.output ? [{ seq: 1, at: run.endedAt ?? run.startedAt, kind, text: toText(run.output) }] : [],
  };
}

function toText(raw: string): string {
  const text = redact(stripVTControlCharacters(raw.slice(0, MAX_REDACT_CHARS)).trimEnd());
  const isCut = text.length > MAX_ENTRY_CHARS || raw.length > MAX_REDACT_CHARS;
  return isCut ? `${text.slice(0, MAX_ENTRY_CHARS)}…` : text;
}
