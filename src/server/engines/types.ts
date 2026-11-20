import type { Agent } from '../db.ts';

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface TurnResult {
  text: string;
  sessionId: string | null;
  usage: TurnUsage;
  /** Prompt size of the turn's last model call, i.e. the session's current context. Unset when the CLI does not say. */
  contextTokens?: number;
  isError: boolean;
}

export interface EngineAdapter {
  /** Shell command line for one turn. The prompt itself goes to stdin. */
  command(agent: Agent, opts: { resumeId: string | null; extraDirs: string[] }): string;
  /** Execute providers that communicate over an API instead of spawning a CLI. */
  run?: (agent: Agent, prompt: string, timeoutMs: number) => Promise<TurnResult>;
  /** Convert the hub prompt to the CLI's stdin protocol when it is not plain text. */
  formatInput?: (prompt: string) => string;
  parse(stdout: string, stderr: string, exitCode: number | null): TurnResult;
  /** Usage reported for a resumed session is the running total of the whole session, not this turn. */
  cumulativeUsage?: boolean;
  /** True once stdout shows the turn finished, so a CLI that then fails to exit can be ended instead of timing out. */
  isTurnOver?: (stdout: string) => boolean;
}

export const EMPTY_USAGE: TurnUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
};

/** Quote one argument for cmd.exe / sh when spawned with shell: true. */
export function q(arg: string): string {
  if (/^[\w@%+=:,./\-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}
