import { ISOLATION, RESET_POLICY, AGENT_STATUS, RUN_STATUS, TASK_STATUS, type Engine } from '../shared/contracts.ts';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DATA_DIR,
  createRun,
  finishRun,
  getAgent,
  getTask,
  getWorkspace,
  lastSessionRun,
  listAgents,
  listMessages,
  listTasks,
  now,
  sessionUsage,
  updateAgent,
  type Agent,
  type Message,
  type Run,
  type Workspace,
} from './db.ts';
import { adapterFor, type TurnResult } from './engines/index.ts';
import { engineDefaults } from './engines/catalog.ts';
import { engineBlock } from './availability.ts';
import { OPENROUTER_API_KEY_ENV } from './engines/openrouter.ts';
import { hasGitHead } from './git.ts';
import { emit } from './events.ts';
import { formatIncoming, preamble, type Brief } from './preamble.ts';

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
    // The repo can change after the agent was saved; say what to fix rather than surface git's own error.
    if (!hasGitHead(ws.repoPath))
      throw new Error(
        `"${ws.repoPath}" is not a git repository with at least one commit, which worktree isolation needs. ` +
          `Run "git init" and make a first commit there, or switch agent "${agent.name}" to shared isolation.`,
      );
    mkdirSync(base, { recursive: true });
    execFileSync('git', ['-C', ws.repoPath, 'worktree', 'add', '--detach', path], { stdio: 'pipe' });
  }
  return path;
}

interface TurnOutcome {
  run: Run;
  result: TurnResult;
}

/** A session idle this long has lost its prompt cache, so resuming it would re-write the whole history at full price. */
const SESSION_IDLE_ROTATE_MS = 60 * 60_000;
/** Brief files are inlined up to this many characters in total; the rest the agent reads itself. */
const MAX_BRIEF_CHARS = 60_000;
const MAX_HANDOFF_CHARS = 4_000;
/** Messages the hub copies into a handoff note it has to write itself. */
const HUB_HANDOFF_MESSAGES = 8;
const HANDOFF_PROMPT = [
  '[From: hub | act: handoff]',
  'The hub is about to continue your work in a fresh session to save tokens; this conversation will be gone.',
  'Reply with a handoff note for your future self, at most 300 words: open work with task keys, decisions made',
  'and who made them, key files and paths, and the next step. Leave out your role, team, rules and messaging',
  'instructions: the next session gets those again. Plain text only. Do not send outbox messages.',
].join('\n');

const OPEN_TASK = new Set<string>([TASK_STATUS.todo, TASK_STATUS.doing, TASK_STATUS.review, TASK_STATUS.blocked]);

export interface Incoming {
  message: Message;
  fromName: string;
}

/**
 * Run one headless turn of an agent for the messages waiting for it (the first one owns the run), on `engine`:
 * the agent's own, or its fallback while its own is out of quota.
 */
export async function runTurn(agentId: string, batch: Incoming[], engine?: Engine): Promise<TurnOutcome> {
  const message = batch[0]!.message;
  let agent = getAgent(agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);
  const ws = getWorkspace(agent.workspaceId)!;
  updateAgent(agent.id, { status: AGENT_STATUS.working });
  emit({ type: 'agent', workspaceId: ws.id, id: agent.id });

  const target = engine ?? agent.engine;
  const sessionEngine = agent.activeEngine ?? agent.engine;
  if (agent.sessionId && sessionEngine !== target)
    agent = { ...agent, ...(await leaveSession(agent, sessionEngine, ws, message.id)) };
  else if (agent.sessionId && shouldRotate(agent, agent.sessionId))
    agent = { ...agent, ...(await rotateSession(runsAs(agent, sessionEngine), ws, message.id)) };
  const activeEngine = target === agent.engine ? null : target;
  if (agent.activeEngine !== activeEngine) updateAgent(agent.id, { activeEngine });
  const current = runsAs({ ...agent, activeEngine }, target);
  const formatted = batch.map((m) =>
    formatIncoming(m.message, m.fromName, m.message.taskId ? getTask(m.message.taskId)?.key : undefined),
  );
  const incoming =
    formatted.length === 1
      ? formatted[0]!
      : `You have ${formatted.length} new messages; handle all of them in this turn.\n\n${formatted.join('\n\n---\n\n')}`;
  const outcome = await runPrompt(current, ws, message.id, (cwd) =>
    current.sessionId
      ? incoming
      : `${preamble(current, listAgents(ws.id), ws, outboxDir(current.id), {
          briefs: loadBriefs(current.briefFiles, cwd),
          openTasks: listTasks(ws.id).filter((t) => t.assigneeId === current.id && OPEN_TASK.has(t.status)),
        })}\n\n---\n\n${incoming}`,
  );

  const { result } = outcome;
  const isSameSession = !!result.sessionId && result.sessionId === current.sessionId;
  updateAgent(current.id, {
    sessionId: result.sessionId ?? current.sessionId,
    turnsInSession: (isSameSession ? current.turnsInSession : 0) + 1,
    status: current.paused ? AGENT_STATUS.paused : AGENT_STATUS.idle,
  });
  emit({ type: 'agent', workspaceId: ws.id, id: current.id });
  return outcome;
}

/**
 * Checked before a turn rather than after one, so the outbox of the turn that crossed the limit is delivered
 * without waiting for the handoff note.
 */
function shouldRotate(agent: Agent, sessionId: string): boolean {
  const last = lastSessionRun(agent.id, sessionId);
  if (!last?.endedAt) return false;
  if (Date.now() - Date.parse(last.endedAt) > SESSION_IDLE_ROTATE_MS) return true;
  if (agent.resetValue <= 0) return false;
  if (agent.resetPolicy === RESET_POLICY.turns) return agent.turnsInSession >= agent.resetValue;
  // shortcut: Antigravity only reports usage summed over all model calls, so it sets no contextTokens and is
  // rotated only by idle time or turns; parse its per-call usage to rotate it by size too.
  return agent.resetPolicy === RESET_POLICY.context && last.contextTokens >= agent.resetValue;
}

/**
 * Ask the agent for a handoff note in its old session, then drop that session. Works for any engine with sessions
 * because the note is plain reply text; the next fresh session gets it in its preamble.
 */
async function rotateSession(agent: Agent, ws: Workspace, messageId: string): Promise<SessionPatch> {
  const { result } = await runPrompt(agent, ws, messageId, () => HANDOFF_PROMPT);
  // A failed note keeps the previous one; the session is dropped either way, since it is what costs tokens.
  const handoff = result.isError ? agent.handoff : result.text.trim().slice(0, MAX_HANDOFF_CHARS);
  const patch = { sessionId: null, turnsInSession: 0, handoff };
  updateAgent(agent.id, patch);
  return patch;
}

type SessionPatch = Pick<Agent, 'sessionId' | 'turnsInSession' | 'handoff'>;

/**
 * Switching engines: a session only resumes on the CLI that made it. The old engine writes the handoff note when it
 * still can; an engine that is out of quota cannot, so the hub writes one from the agent's recent messages.
 */
async function leaveSession(agent: Agent, sessionEngine: Engine, ws: Workspace, messageId: string) {
  if (!engineBlock(sessionEngine)) return rotateSession(runsAs(agent, sessionEngine), ws, messageId);
  const names = new Map(listAgents(ws.id).map((a) => [a.id, a.name]));
  const recent = listMessages(ws.id)
    .filter((m) => m.fromId === agent.id || m.toId === agent.id)
    .slice(-HUB_HANDOFF_MESSAGES)
    .map((m) => `- ${names.get(m.fromId) ?? m.fromId} -> ${names.get(m.toId) ?? m.toId}: ${m.body.slice(0, 300)}`);
  const handoff = [
    `Written by the hub: ${sessionEngine} ran out of quota before you could write a note.`,
    agent.handoff ? `Your previous note:\n${agent.handoff}` : '',
    recent.length ? `Recent messages:\n${recent.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_HANDOFF_CHARS);
  const patch = { sessionId: null, turnsInSession: 0, handoff };
  updateAgent(agent.id, patch);
  return patch;
}

/** The agent as it runs on `engine`: on a fallback it borrows that CLI's default command and flags. */
function runsAs(agent: Agent, engine: Engine): Agent {
  if (engine === agent.engine) return agent;
  const defaults = engineDefaults(engine);
  return {
    ...agent,
    engine,
    model: agent.fallbackModel,
    command: defaults.defaultCommand,
    extraArgs: defaults.defaultExtraArgs,
    // A fallback only stands in for a while, so it starts lean (cheapest) rather than with every user plugin.
    isLean: true,
    mcpServers: [],
  };
}

/** Inline brief files so a fresh session does not spend model calls reading them. */
function loadBriefs(files: string[], cwd: string): Brief[] {
  let budget = MAX_BRIEF_CHARS;
  return files.map((path) => {
    const full = resolve(cwd, path);
    if (!existsSync(full)) return { path, content: null };
    const content = readFileSync(full, 'utf8');
    if (content.length > budget) return { path, content: null };
    budget -= content.length;
    return { path, content };
  });
}

/** Execute one prompt on the agent's current session and record it as a run. */
async function runPrompt(
  agent: Agent,
  ws: Workspace,
  messageId: string,
  buildPrompt: (cwd: string) => string,
): Promise<TurnOutcome> {
  const adapter = adapterFor(agent.engine);
  const outbox = outboxDir(agent.id);
  const run = createRun(agent.id, messageId);
  const timeoutMs = ws.settings.turnTimeoutMin * 60_000;

  let result: TurnResult;
  let exitCode: number | null = null;
  try {
    if (adapter.run) {
      result = await adapter.run(agent, buildPrompt(ws.repoPath || '.'), timeoutMs);
      exitCode = result.isError ? 1 : 0;
    } else {
      const cwd = resolveCwd(agent, ws);
      const prompt = buildPrompt(cwd);
      const cmd = adapter.command(agent, { resumeId: agent.sessionId, extraDirs: [outbox] });
      const out = await exec(
        cmd,
        adapter.formatInput?.(prompt) ?? prompt,
        cwd,
        timeoutMs,
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
    }
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
    contextTokens: result.contextTokens ?? 0,
    sessionId: result.sessionId,
  });
  finishRun(run);
  emit({ type: 'run', workspaceId: ws.id, id: run.id });
  return { run, result };
}

/** The user asked for a clean start, so the old handoff note goes too. */
export function resetSession(agentId: string) {
  updateAgent(agentId, { sessionId: null, turnsInSession: 0, handoff: '' });
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
    const childEnv = { ...process.env };
    delete childEnv[OPENROUTER_API_KEY_ENV];
    const child = spawn(cmd, {
      shell: true,
      cwd,
      env: { ...childEnv, ...env },
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
