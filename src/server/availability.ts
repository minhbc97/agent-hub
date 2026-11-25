import { USAGE_STATUS, type Engine, type EngineUsage, type UsageReport } from '../shared/contracts.ts';

/** With no reset time known, try the engine again after this long; a still-exhausted engine just blocks again. */
export const QUOTA_RECHECK_MS = 15 * 60_000;
export const FULL_PERCENT = 100;

interface Block {
  reason: string;
  until: number;
}

/** In memory on purpose: after a restart the next turn rediscovers a limit within one failed call. */
const blocks = new Map<Engine, Block>();
/** Latest plan reading of each engine, for pause limits below 100%. */
const readings = new Map<Engine, EngineUsage>();

export function blockEngine(engine: Engine, reason: string, until: number) {
  blocks.set(engine, { reason, until });
}

/** The engine's current block, or null once it has expired. */
export function engineBlock(engine: Engine, now = Date.now()): Block | null {
  const block = blocks.get(engine);
  if (!block) return null;
  if (block.until > now) return block;
  blocks.delete(engine);
  return null;
}

/** Why new work waits: the engine is blocked, or its plan usage reached the workspace's own pause limit. */
export function quotaHold(engine: Engine, pausePercent: number, now = Date.now()): Block | null {
  const block = engineBlock(engine, now);
  const reading = readings.get(engine);
  if (block || !reading || pausePercent >= FULL_PERCENT) return block;
  // Every window over the limit has to reset before the engine is under it again.
  const over = reading.windows
    .filter((w) => w.usedPercent >= pausePercent && w.resetsAt && Date.parse(w.resetsAt) > now)
    .sort((a, b) => Date.parse(b.resetsAt!) - Date.parse(a.resetsAt!))[0];
  if (!over) return null;
  return {
    reason: `${reading.label} usage at ${Math.floor(over.usedPercent)}% (pause limit ${pausePercent}%)`,
    until: Date.parse(over.resetsAt!),
  };
}

/** A fresh plan reading is newer evidence than an old failure, in both directions. */
export function noteUsage(report: UsageReport, now = Date.now()) {
  for (const usage of report.engines) {
    if (usage.status === USAGE_STATUS.notSignedIn) {
      blockEngine(usage.engine, `${usage.label} is not signed in`, now + QUOTA_RECHECK_MS);
      continue;
    }
    if (usage.status !== USAGE_STATUS.ok) continue;
    readings.set(usage.engine, usage);
    const full = usage.windows.find((w) => w.usedPercent >= FULL_PERCENT && w.resetsAt);
    if (full) blockEngine(usage.engine, `${usage.label} quota reached`, Date.parse(full.resetsAt!));
    else blocks.delete(usage.engine);
  }
}

const RESETS_IN = /Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i;
/** Claude Code's own wording: `Claude AI usage limit reached|<unix seconds>`. */
const CLAUDE_RESET = /usage limit reached\|(\d{10})/i;
const QUOTA_ERROR =
  /RESOURCE_EXHAUSTED|usage limit|rate[ _-]?limit|quota (?:reached|exceeded)|hit your (?:usage )?limit|limit reached/i;

/**
 * Whether a failed turn's text is a plan or rate limit rather than a real failure.
 * Returns when to try again, or undefined when the text is some other error.
 */
export function quotaRetryAt(text: string, now = Date.now()): number | undefined {
  if (!QUOTA_ERROR.test(text)) return undefined;
  const claudeReset = CLAUDE_RESET.exec(text);
  if (claudeReset) return Number(claudeReset[1]) * 1000;
  const resetsIn = RESETS_IN.exec(text);
  if (resetsIn) {
    const [, h = '0', m = '0', s = '0'] = resetsIn;
    return now + ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
  }
  return now + QUOTA_RECHECK_MS;
}
