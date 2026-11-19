import { ISOLATION, RESET_POLICY, AGENT_STATUS, RUN_STATUS } from '../shared/contracts.ts';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DATA_DIR,
  createRun,
  finishRun,
  getAgent,
  getWorkspace,
  listAgents,
  now,
  sessionUsage,
  updateAgent,
  type Agent,
  type Message,
  type Run,
  type Workspace,
} from './db.ts';
import { adapterFor, type TurnResult } from './engines/index.ts';
import { emit } from './events.ts';
import { formatIncoming, preamble } from './preamble.ts';

const HUB_URL = `http://127.0.0.1:${process.env.HUB_PORT ?? 4310}`;

export function outboxDir(agentId: string): string {
  const dir = join(DATA_DIR, 'outbox', agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Working directory for an agent, creating its git worktree on first use. */
function resolveCwd(agent: Agent, ws: Workspace): string {
  if (agent.isolation === ISOLATION.custom) {
    if (!agent.cwd) throw new Error(`Agent "${agent.name}" uses custom isolation but has no cwd`);
    return resolve(agent.cwd);
  }
  if (!ws.repoPath) throw new Error(`Workspace "${ws.name}" has no repo path`);
  if (agent.isolation === ISOLATION.shared) return resolve(ws.repoPath);

  const base = ws.worktreesDir || join(ws.repoPath, '..', `${ws.name}-worktrees`);
  const path = resolve(base, agent.name);
  if (!existsSync(path)) {
    mkdirSync(base, { recursive: true });
    execFileSync('git', ['-C', ws.repoPath, 'worktree', 'add', '--detach', path], { stdio: 'pipe' });
  }
  return path;
}

interface TurnOutcome {
  run: Run;
  result: TurnResult;
}

/** Run one headless turn of an agent for one incoming message. */
export async function runTurn(agentId: string, message: Message, fromName: string): Promise<TurnOutcome> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);
  const ws = getWorkspace(agent.workspaceId)!;
  const adapter = adapterFor(agent.engine);
  const outbox = outboxDir(agent.id);

  const fresh = !agent.sessionId;
  const incoming = formatIncoming(message, fromName);
  const prompt = fresh ? `${preamble(agent, listAgents(ws.id), ws, outbox)}\n\n---\n\n${incoming}` : incoming;

  const run = createRun(agent.id, message.id);
  updateAgent(agent.id, { status: AGENT_STATUS.working });
  emit({ type: 'agent', workspaceId: ws.id, id: agent.id });

  let result: TurnResult;
  let exitCode: number | null = null;
  try {
    const cwd = resolveCwd(agent, ws);
    const cmd = adapter.command(agent, {
      resumeId: agent.sessionId,
      extraDirs: [outbox],
    });
    const out = await exec(
      cmd,
      prompt,
      cwd,
      ws.settings.turnTimeoutMin * 60_000,
      { HUB_OUTBOX: outbox, HUB_AGENT: agent.name, HUB_URL },
      adapter.isTurnOver,
    );
    // Killed by us after the CLI reported the turn finished: that is a normal end, not a crash.
    exitCode = out.endedEarly ? 0 : out.code;
    result = out.timedOut
      ? {
          ...adapter.parse(out.stdout, out.stderr, exitCode),
          isError: true,
          text: `Timed out after ${ws.settings.turnTimeoutMin} min`,
        }
      : adapter.parse(out.stdout, out.stderr, exitCode);
  } catch (err) {
    result = adapter.parse('', String((err as Error).message), null);
    result.isError = true;
  }

  if (adapter.cumulativeUsage && result.sessionId && result.sessionId === agent.sessionId) {
    const before = sessionUsage(agent.id, result.sessionId);
    const u = result.usage;
    result.usage = {
      ...u,
      inputTokens: Math.max(0, u.inputTokens - before.inputTokens),
      outputTokens: Math.max(0, u.outputTokens - before.outputTokens),
      cacheWriteTokens: Math.max(0, u.cacheWriteTokens - before.cacheWriteTokens),
      cacheReadTokens: Math.max(0, u.cacheReadTokens - before.cacheReadTokens),
    };
  }
  Object.assign(run, result.usage, {
    endedAt: now(),
    status: result.isError ? RUN_STATUS.failed : RUN_STATUS.ok,
    exitCode,
    output: result.text,
    sessionId: result.sessionId,
  });
  finishRun(run);

  // Session bookkeeping and reset policy.
  const turns = (result.sessionId && result.sessionId === agent.sessionId ? agent.turnsInSession : 0) + 1;
  const context = result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens;
  const reset =
    (agent.resetPolicy === RESET_POLICY.turns && agent.resetValue > 0 && turns >= agent.resetValue) ||
    (agent.resetPolicy === RESET_POLICY.context && agent.resetValue > 0 && context >= agent.resetValue);
  updateAgent(agent.id, {
    sessionId: reset ? null : (result.sessionId ?? agent.sessionId),
    turnsInSession: reset ? 0 : turns,
    status: agent.paused ? AGENT_STATUS.paused : AGENT_STATUS.idle,
  });
  emit({ type: 'run', workspaceId: ws.id, id: run.id });
  emit({ type: 'agent', workspaceId: ws.id, id: agent.id });
  return { run, result };
}

export function resetSession(agentId: string) {
  updateAgent(agentId, { sessionId: null, turnsInSession: 0 });
}

interface ExecOut {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  /** The CLI reported its turn finished but did not exit (e.g. a command it started still hangs), so we ended it. */
  endedEarly: boolean;
}

/** Time a CLI gets to exit by itself after reporting its turn finished. */
const TURN_EXIT_GRACE_MS = 10_000;

function exec(
  cmd: string,
  stdin: string,
  cwd: string,
  timeoutMs: number,
  env: Record<string, string>,
  isTurnOver?: (stdout: string) => boolean,
): Promise<ExecOut> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, {
      shell: true,
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let endedEarly = false;
    let graceTimer: NodeJS.Timeout | undefined;
    child.stdout.setEncoding('utf8').on('data', (d) => {
      stdout += d;
      if (graceTimer || !isTurnOver?.(stdout)) return;
      graceTimer = setTimeout(() => {
        endedEarly = true;
        killTree(child.pid);
      }, TURN_EXIT_GRACE_MS);
    });
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolvePromise({ stdout, stderr, code, timedOut, endedEarly });
    });
    child.stdin.on('error', () => {}); // process may exit before reading stdin
    child.stdin.end(stdin, 'utf8');
  });
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    else process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}
