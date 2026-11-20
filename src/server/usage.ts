import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  ENGINE,
  LIMIT_WINDOW,
  USAGE_STATUS,
  type Engine,
  type EngineInfo,
  type EngineUsage,
  type UsageReport,
  type UsageWindow,
} from '../shared/contracts.ts';
import { noteUsage } from './availability.ts';

/** The header shows "up to 1 min old"; within that, every caller shares one reading. */
const CACHE_MS = 60_000;
const CLAUDE_USAGE_TIMEOUT_MS = 30_000;
const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const CODEX_ROLLOUT = /^rollout-.*\.jsonl$/;
const DATE_FOLDER = /^\d+$/;
const USAGE_REQUEST_ID = 'agent-hub-usage';
/** Engines with a plan meter in the header; custom CLIs have no account to read. */
const METERED: Engine[] = [ENGINE.claude, ENGINE.codex, ENGINE.antigravity];

let cached: { at: number; report: Promise<UsageReport> } | null = null;

export function usageReport(engines: EngineInfo[], refresh: boolean): Promise<UsageReport> {
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  const report = readReport(engines);
  cached = { at: Date.now(), report };
  // A failed read must not stick for a minute.
  report.catch(() => (cached = null));
  return report;
}

async function readReport(engines: EngineInfo[]): Promise<UsageReport> {
  const list = await Promise.all(
    METERED.map(async (id): Promise<EngineUsage> => {
      const info = engines.find((e) => e.id === id);
      const base = { engine: id, label: info?.label ?? id, plan: null, windows: [] };
      if (info?.installed === false) return { ...base, status: USAGE_STATUS.notInstalled };
      try {
        if (id === ENGINE.claude) return { ...base, ...(await readClaude(info?.defaultCommand ?? id)) };
        if (id === ENGINE.codex) return { ...base, ...readCodex() };
        return { ...base, ...readAntigravity() };
      } catch (err) {
        console.error(`usage: ${id}: ${(err as Error).message}`);
        return { ...base, status: USAGE_STATUS.error };
      }
    }),
  );
  const report = { takenAt: new Date().toISOString(), engines: list };
  noteUsage(report);
  return report;
}

type Reading = Pick<EngineUsage, 'status' | 'plan' | 'windows'>;

/** Claude Code answers a `get_usage` control request without calling a model, using its own login. */
function readClaude(command: string): Promise<Reading> {
  return new Promise((resolve, reject) => {
    // shell: the CLI is a .cmd shim on Windows; the command comes from the engine catalog, never from a request.
    const child = spawn(`${command} -p --input-format stream-json --output-format stream-json --verbose`, {
      shell: true,
      windowsHide: true,
    });
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('timed out')), CLAUDE_USAGE_TIMEOUT_MS);
    const finish = (out: Reading | Error) => {
      clearTimeout(timer);
      child.kill();
      if (out instanceof Error) reject(out);
      else resolve(out);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const reading = parseClaudeUsageLine(line);
        if (reading) return finish(reading);
      }
    });
    child.on('error', finish);
    child.on('close', (code) => finish(new Error(`exited with ${code} before answering`)));
    child.stdin.end(
      JSON.stringify({ type: 'control_request', request_id: USAGE_REQUEST_ID, request: { subtype: 'get_usage' } }) +
        '\n',
    );
  });
}

/** One stdout line of `claude --output-format stream-json`; null until the usage answer arrives. */
export function parseClaudeUsageLine(line: string): Reading | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  const response = field(field(msg, 'response'), 'response');
  if (field(msg, 'type') !== 'control_response' || !response) return null;
  const limits = field(response, 'rate_limits');
  const windows = [
    claudeWindow(field(limits, 'five_hour'), LIMIT_WINDOW.session),
    claudeWindow(field(limits, 'seven_day'), LIMIT_WINDOW.week),
  ].filter((w): w is UsageWindow => w !== null);
  const plan = field(response, 'subscription_type');
  return {
    status: windows.length ? USAGE_STATUS.ok : USAGE_STATUS.noReading,
    plan: typeof plan === 'string' ? plan : null,
    windows,
  };
}

function claudeWindow(raw: unknown, window: UsageWindow['window']): UsageWindow | null {
  const used = field(raw, 'utilization');
  if (typeof used !== 'number') return null;
  const resetsAt = field(raw, 'resets_at');
  return { window, usedPercent: used, resetsAt: typeof resetsAt === 'string' ? resetsAt : null };
}

/** Codex writes its plan limits into every session log; the newest one is the current reading. */
function readCodex(): Reading {
  const file = newestRollout(CODEX_SESSIONS_DIR);
  if (!file) return { status: USAGE_STATUS.noReading, plan: null, windows: [] };
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const reading = parseCodexRolloutLine(lines[i]!, Date.now());
    if (reading) return reading;
  }
  return { status: USAGE_STATUS.noReading, plan: null, windows: [] };
}

/** Sessions live in YYYY/MM/DD folders, so the newest file is under the last folder name at each level. */
function newestRollout(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && CODEX_ROLLOUT.test(e.name))
    .map((e) => join(dir, e.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files[0]) return files[0];
  // Only date folders: other tools keep their own Codex sessions beside them (e.g. a `munder-difflin/` folder).
  const folders = entries
    .filter((e) => e.isDirectory() && DATE_FOLDER.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const folder of folders) {
    const found = newestRollout(join(dir, folder));
    if (found) return found;
  }
  return null;
}

/** One rollout line; null unless it carries rate limits. A window whose reset already passed reads as 0%. */
export function parseCodexRolloutLine(line: string, now: number): Reading | null {
  if (!line.includes('"rate_limits"')) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  const limits = field(field(msg, 'payload'), 'rate_limits');
  if (!limits) return null;
  const windows = [
    codexWindow(field(limits, 'primary'), LIMIT_WINDOW.session, now),
    codexWindow(field(limits, 'secondary'), LIMIT_WINDOW.week, now),
  ].filter((w): w is UsageWindow => w !== null);
  if (!windows.length) return null;
  const plan = field(limits, 'plan_type');
  return { status: USAGE_STATUS.ok, plan: typeof plan === 'string' ? plan : null, windows };
}

function codexWindow(raw: unknown, window: UsageWindow['window'], now: number): UsageWindow | null {
  const used = field(raw, 'used_percent');
  const resetsAtSec = field(raw, 'resets_at');
  if (typeof used !== 'number') return null;
  if (typeof resetsAtSec !== 'number') return { window, usedPercent: used, resetsAt: null };
  const resetsAtMs = resetsAtSec * 1000;
  if (resetsAtMs <= now) return { window, usedPercent: 0, resetsAt: null };
  return { window, usedPercent: used, resetsAt: new Date(resetsAtMs).toISOString() };
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

/** The CLI writes one log per run; a few newest ones cover the latest sign-in and quota events. */
const ANTIGRAVITY_LOG_DIR = join(homedir(), '.gemini', 'antigravity-cli', 'log');
const ANTIGRAVITY_LOGS_READ = 5;
const ANTIGRAVITY_LOG_FILE = /^cli-(\d{4})\d{4}_\d{6}\.log$/;

/**
 * Antigravity reports no usage percentages, so the hub reads what its CLI logs: whether the account is signed in,
 * and when a request was refused for quota, how long until it resets.
 */
function readAntigravity(): Reading {
  if (!existsSync(ANTIGRAVITY_LOG_DIR)) return { status: USAGE_STATUS.noSource, plan: null, windows: [] };
  const logs = readdirSync(ANTIGRAVITY_LOG_DIR)
    .filter((name) => ANTIGRAVITY_LOG_FILE.test(name))
    .sort()
    .slice(-ANTIGRAVITY_LOGS_READ)
    .map((name) => ({ name, text: readFileSync(join(ANTIGRAVITY_LOG_DIR, name), 'utf8') }));
  return parseAntigravityLogs(logs, Date.now());
}

/** Logs oldest first; the last sign-in event and the last quota refusal decide the reading. */
export function parseAntigravityLogs(logs: { name: string; text: string }[], now: number): Reading {
  let isSignedIn: boolean | null = null;
  let quotaResetsAt: number | null = null;
  for (const { name, text } of logs) {
    const year = ANTIGRAVITY_LOG_FILE.exec(name)?.[1];
    for (const line of text.split('\n')) {
      // Sign-in lines also carry the account's email; only the fact of the event is kept.
      if (line.includes('applyAuthResult:')) isSignedIn = true;
      else if (line.includes('(not logged in)')) isSignedIn = false;
      const refused = /RESOURCE_EXHAUSTED.*Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(line);
      const at = year ? logLineTime(line, year) : null;
      if (!refused || at === null) continue;
      const [, h = '0', m = '0', s = '0'] = refused;
      quotaResetsAt = at + ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
    }
  }
  if (isSignedIn === false) return { status: USAGE_STATUS.notSignedIn, plan: null, windows: [] };
  if (quotaResetsAt !== null && quotaResetsAt > now)
    return {
      status: USAGE_STATUS.ok,
      plan: null,
      windows: [{ window: LIMIT_WINDOW.quota, usedPercent: 100, resetsAt: new Date(quotaResetsAt).toISOString() }],
    };
  return { status: USAGE_STATUS.noSource, plan: null, windows: [] };
}

/** glog prefix `E1120 11:16:17.259359`: month, day and local time; the year comes from the file name. */
function logLineTime(line: string, year: string): number | null {
  const m = /^[IWEF](\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(line);
  if (!m) return null;
  const [, month, day, hour, minute, second] = m.map(Number) as number[];
  return new Date(Number(year), month! - 1, day, hour, minute, second).getTime();
}
