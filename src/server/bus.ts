import {
  USER_ID,
  isSameAgentName,
  ASK_OPTIONS_MAX,
  ASK_OPTION_MAX_LENGTH,
  HUB_ID,
  ACT,
  MESSAGE_STATUS,
  AGENT_STATUS,
  ENGINE,
  ISOLATION,
  TASK_STATUS,
  ROUTING,
  FALLBACK_ENGINES,
  type Engine,
} from '../shared/contracts.ts';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  createMessage,
  agentHops,
  createTask,
  detachMessage,
  failInterrupted,
  findTaskByKey,
  getAgent,
  getMessage,
  getTask,
  getWorkspace,
  listAgents,
  listWorkspaces,
  pendingFor,
  resolveLooseQuestions,
  setMessageStatus,
  turnsLastHour,
  updateAgent,
  updateTask,
  type Act,
  type Agent,
  type Message,
  type Task,
  type Workspace,
} from './db.ts';
import { emit } from './events.ts';
import { DomainError } from './domain-error.ts';
import { outboxDir, resetSession, runTurn } from './runner.ts';
import { agentAsks, agentDone, tickSchedules } from './workflow.ts';
import { parseTaskReply } from './engines/openrouter.ts';
import { taskBranch } from './task-branch.ts';
import { blockEngine, engineBlock, quotaRetryAt } from './availability.ts';

/** Outbox "task" value that asks the hub to create a new task for the recipient. */
const NEW_TASK_REF = 'new';
const OUTBOX_ACTS: Act[] = [ACT.request, ACT.query, ACT.inform, ACT.done, ACT.needsHuman];
/** A file that still fails to parse after this long is treated as broken, not half-written. */
const PARSE_GRACE_MS = 30_000;
/** Outbox messages are short JSON; anything bigger is rejected unread so it cannot balloon the hub's memory. */
const MAX_OUTBOX_FILE_BYTES = 256 * 1024;

const running = new Set<string>();

// ---------------------------------------------------------------- outbox

interface OutboxResult {
  accepted: Message[];
  rejected: { file: string; reason: string }[];
}

/**
 * Read every JSON file an agent dropped into its outbox, queue the valid ones, move files aside.
 * `parentId` is the message whose turn wrote these files; it links them into a chain for the loop guard.
 */
function scanOutbox(agent: Agent, parentId: string | null): OutboxResult {
  const dir = outboxDir(agent.id);
  const res: OutboxResult = { accepted: [], rejected: [] };
  // Oldest first, so messages keep the order the agent wrote them in.
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    // throwIfNoEntry: the agent may rename or delete a file between readdir and stat.
    .map((e) => ({ name: e.name, t: statSync(join(dir, e.name), { throwIfNoEntry: false })?.mtimeMs }))
    .filter((e): e is { name: string; t: number } => e.t !== undefined)
    .sort((a, b) => a.t - b.t || a.name.localeCompare(b.name))
    .map((e) => e.name);
  if (!files.length) return res;

  const ws = getWorkspace(agent.workspaceId)!;
  const team = listAgents(ws.id);
  let finished = false;
  const loopHold = loopHoldReason(parentId, ws);

  for (const name of files) {
    const path = join(dir, name);
    const size = statSync(path, { throwIfNoEntry: false })?.size;
    if (size === undefined) continue;
    if (size > MAX_OUTBOX_FILE_BYTES) {
      reject(dir, name, `file is larger than ${MAX_OUTBOX_FILE_BYTES} bytes`, res);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      const stat = statSync(path, { throwIfNoEntry: false });
      if (!stat || Date.now() - stat.mtimeMs < PARSE_GRACE_MS) continue; // gone, or maybe still being written
      reject(dir, name, `invalid JSON: ${(e as Error).message}`, res);
      continue;
    }
    // Claim the file before creating anything: if the move fails (e.g. antivirus holds a lock on Windows),
    // nothing was queued yet and the next tick simply tries again instead of queueing duplicates.
    let claimed: string;
    try {
      claimed = move(dir, name, 'processed');
    } catch {
      continue;
    }
    const items = Array.isArray(raw) ? raw : [raw];
    const errors: string[] = [];
    for (const item of items) {
      const v = validate(item, agent, team, ws);
      if (typeof v === 'string') {
        errors.push(v);
        continue;
      }
      let taskId = v.taskId;
      if (v.newTask) {
        // An agent delegating work creates a task assigned to the recipient, visible on the board.
        const task = createTask({
          workspaceId: ws.id,
          title: (v.subject || v.body.split('\n')[0] || 'Task').slice(0, 200),
          body: v.body,
          assigneeId: v.toId,
          createdBy: agent.id,
          status: TASK_STATUS.doing,
        });
        taskId = task.id;
        emit({ type: 'task', workspaceId: ws.id, id: task.id });
      }
      // Mail to the human ends a chain, so only agent recipients can be stopped by the loop guard.
      const stopped = v.toId !== USER_ID && loopHold;
      const msg = createMessage({
        workspaceId: ws.id,
        fromId: agent.id,
        toId: v.toId,
        act: v.act,
        subject: v.subject,
        body: v.body,
        urgent: v.urgent,
        taskId,
        parentId,
        options: v.options,
        // Messages to the human are final; needs_human waits in the approvals queue.
        // A stopped message waits as failed: the human reads it and presses Retry to let the chain go on.
        status: stopped
          ? MESSAGE_STATUS.failed
          : v.toId === USER_ID
            ? v.act === ACT.needsHuman
              ? MESSAGE_STATUS.held
              : MESSAGE_STATUS.delivered
            : MESSAGE_STATUS.queued,
        holdReason: stopped || (v.toId === USER_ID && v.act === ACT.needsHuman ? 'awaiting approval' : null),
      });
      if (stopped) blockTaskOnFailure(msg, v.toId, stopped);
      if (v.act === ACT.done) finished = true;
      res.accepted.push(msg);
      emit({ type: 'message', workspaceId: ws.id, id: msg.id });
      const task = taskId && !v.newTask ? getTask(taskId) : undefined;
      if (task && v.act === ACT.done) {
        const isComplete = agentDone(task, agent.id, v.body);
        // A "done" addressed to the delegator already carries the result.
        if (isComplete && v.toId !== task.createdBy) reportToDelegator(task, agent, v.body || v.subject, parentId);
      }
      if (task && v.act === ACT.needsHuman) agentAsks(task, v.body || v.subject);
    }
    if (errors.length) {
      let target = claimed;
      try {
        target = join(dir, 'rejected', basename(claimed));
        mkdirSync(dirname(target), { recursive: true });
        renameSync(claimed, target);
      } catch {
        target = claimed; // the valid items are already queued; keeping the file in processed/ is fine
      }
      res.rejected.push({ file: name, reason: errors.join('; ') });
      writeFileSync(`${target}.error.txt`, errors.join('; ') + '\n');
    }
  }
  if (finished) resetSession(agent.id);
  if (res.rejected.length) reportRejected(agent, res.rejected);
  return res;
}

/** Why the loop guard stops an agent message continuing `parentId`'s chain (the message adds one hop), if it does. */
function loopHoldReason(parentId: string | null, ws: Workspace): string | null {
  const hops = (parentId ? agentHops(parentId) : 0) + 1;
  return hops > ws.settings.maxHops ? `loop guard: ${hops} agent messages in a row without a human` : null;
}

/**
 * The agent that delegated a task is not running while it is done, so the result has to wake it up.
 * Sent as the worker, not the hub: hub mail starts a new chain, which would hide delegation loops from the loop guard.
 */
function reportToDelegator(task: Task, worker: Agent, result: string, parentId: string | null) {
  const delegator = getAgent(task.createdBy);
  if (!delegator || delegator.id === worker.id) return; // created by the human or a schedule, or since deleted
  const stopped = loopHoldReason(parentId, getWorkspace(task.workspaceId)!);
  const msg = createMessage({
    workspaceId: task.workspaceId,
    fromId: worker.id,
    toId: delegator.id,
    act: ACT.inform,
    subject: `${task.key} done · ${task.title}`,
    body: task.baseCommit ? `${result}\n\nCode: git diff ${task.baseCommit} ${taskBranch(task)}` : result,
    taskId: task.id,
    parentId,
    status: stopped ? MESSAGE_STATUS.failed : MESSAGE_STATUS.queued,
    holdReason: stopped,
  });
  emit({ type: 'message', workspaceId: task.workspaceId, id: msg.id });
}

/** The agent believes it sent these; tell the human, or a lost question waits forever without anyone knowing. */
function reportRejected(agent: Agent, rejected: OutboxResult['rejected']) {
  const msg = createMessage({
    workspaceId: agent.workspaceId,
    fromId: HUB_ID,
    toId: USER_ID,
    act: ACT.inform,
    subject: `${agent.name}: ${rejected.length} outbox message(s) rejected`,
    body: rejected.map((r) => `${r.file}: ${r.reason}`).join('\n'),
    status: MESSAGE_STATUS.delivered,
  });
  emit({ type: 'message', workspaceId: agent.workspaceId, id: msg.id });
}

interface Valid {
  toId: string;
  act: Act;
  subject: string;
  body: string;
  urgent: boolean;
  taskId: string | null;
  newTask: boolean;
  options: string[];
}

/** Agent-written choices: trimmed, non-empty, unique, capped in count and length. Anything else is dropped. */
export function askOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const clean = raw
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.trim().slice(0, ASK_OPTION_MAX_LENGTH))
    .filter(Boolean);
  return [...new Set(clean)].slice(0, ASK_OPTIONS_MAX);
}

function validate(item: unknown, from: Agent, team: Agent[], ws: Workspace): Valid | string {
  if (!item || typeof item !== 'object') return 'message must be a JSON object';
  const m = item as Record<string, unknown>;
  const to = typeof m.to === 'string' ? m.to.trim().toLowerCase() : '';
  const act = (typeof m.act === 'string' ? m.act.trim() : ACT.inform) as Act;
  const body = typeof m.body === 'string' ? m.body : '';
  let subject = typeof m.subject === 'string' ? m.subject.slice(0, 200) : '';
  if (!to) return '"to" is required';
  if (!OUTBOX_ACTS.includes(act)) return `unknown act "${act}"`;
  if (!body.trim() && !subject.trim()) return 'empty message';
  if (act === ACT.needsHuman && to !== USER_ID) return 'needs_human must be sent to "user"';
  const taskRef = typeof m.task === 'string' ? m.task.trim() : '';
  const newTask = taskRef.toLowerCase() === NEW_TASK_REF;
  let taskId: string | null = null;
  if (taskRef && !newTask) {
    const task = findTaskByKey(ws.id, taskRef);
    if (!task) return `no task "${taskRef}"`;
    taskId = task.id;
  }
  if (to === USER_ID) {
    // Agents used to other tools open a card for every question ("ASK ME"); here a loose question already shows
    // in Needs you, so the card part is dropped rather than losing the question.
    if (newTask && act !== ACT.needsHuman) return 'task "new" needs an agent as recipient';
    return {
      toId: USER_ID,
      act,
      subject,
      body,
      urgent: !!m.urgent,
      taskId,
      newTask: false,
      options: act === ACT.needsHuman ? askOptions(m.options) : [],
    };
  }

  const target = team.find((a) => isSameAgentName(a.name, to));
  if (!target) return `no agent named "${to}"`;
  if (target.id === from.id) return 'cannot message yourself';

  const routed = route(from, target, team, ws);
  if (routed.id !== target.id) subject = `[for ${target.name}] ${subject}`.trim();
  if (routed.id === from.id) return `routing does not allow ${from.name} -> ${target.name}`;
  return {
    toId: routed.id,
    act,
    subject,
    body,
    urgent: !!m.urgent,
    taskId,
    newTask,
    options: [],
  };
}

/** Star: everything goes through the orchestrator. Mesh: listed pairs may talk directly. */
export function route(from: Agent, to: Agent, team: Agent[], ws: Workspace): Agent {
  const orch = team.find((a) => a.isOrchestrator);
  if (!orch || from.id === orch.id || to.id === orch.id) return to;
  if (ws.settings.routing === ROUTING.mesh) {
    const ok = ws.settings.directPairs.some(
      ([x, y]) => (x === from.name && y === to.name) || (x === to.name && y === from.name),
    );
    if (ok) return to;
  }
  return orch;
}

function reject(dir: string, name: string, reason: string, res: OutboxResult) {
  res.rejected.push({ file: name, reason });
  const target = move(dir, name, 'rejected');
  writeFileSync(`${target}.error.txt`, reason + '\n');
}

function move(dir: string, name: string, sub: 'processed' | 'rejected'): string {
  const targetDir = join(dir, sub);
  mkdirSync(targetDir, { recursive: true });
  const target = join(targetDir, `${Date.now()}-${name}`);
  renameSync(join(dir, name), target);
  return target;
}

// ---------------------------------------------------------------- dispatch

/** User (or the hub) sends a message to an agent. */
export function sendFromUser(
  workspaceId: string,
  to: string,
  body: string,
  opts: {
    subject?: string;
    urgent?: boolean;
    act?: Act;
    taskId?: string | null;
  } = {},
) {
  const target = listAgents(workspaceId).find((a) => a.id === to || isSameAgentName(a.name, to.trim()));
  if (!target) throw new DomainError('errors.recipientNotFound', { name: to });
  const msg = createMessage({
    workspaceId,
    fromId: USER_ID,
    toId: target.id,
    act: opts.act ?? ACT.request,
    subject: opts.subject ?? '',
    body,
    urgent: !!opts.urgent,
    taskId: opts.taskId ?? null,
  });
  if (!msg.taskId) resolveLooseQuestions(workspaceId, target.id);
  emit({ type: 'message', workspaceId, id: msg.id });
  return msg;
}

/**
 * One pass: collect outboxes, then start turns for idle agents with mail.
 * Runs from a timer and from promise callbacks, so an error must not escape: it would kill the process.
 */
export function tick(): void {
  try {
    dispatchAll();
  } catch (err) {
    console.error('bus tick failed', err);
  }
}

/** Bounds one turn's prompt when a backlog has built up; the rest goes in the next turn. */
const MAX_BATCH = 10;

function dispatchAll(): void {
  tickSchedules();
  for (const ws of listWorkspaces()) {
    const team = listAgents(ws.id);
    // Files written outside a turn have no triggering message, so they start a new chain.
    for (const a of team) if (!running.has(a.id)) collectOutbox(a, null);

    let active = team.filter((a) => running.has(a.id)).length;
    for (const agent of team) {
      if (running.has(agent.id)) continue;
      const pending = pendingFor(agent.id);
      if (!pending.length) continue;

      const engine = pickEngine(agent);
      const hold = holdReason(agent, ws) ?? (typeof engine === 'string' ? null : engine.hold);
      if (hold || typeof engine !== 'string') {
        for (const m of pending)
          if (m.status !== MESSAGE_STATUS.held || m.holdReason !== hold)
            setMessageStatus(m.id, MESSAGE_STATUS.held, { holdReason: hold });
        continue;
      }
      if (active >= ws.settings.maxConcurrent) break;
      active++;
      // OpenRouter turns map one reply to one task, so they stay one message per turn.
      const batch =
        agent.engine === ENGINE.openrouter ? pending.slice(0, 1) : oneTask(agent, pending).slice(0, MAX_BATCH);
      start(agent, batch, team, engine);
    }
  }
}

/** A worktree is at one task's code at a time, so mail about the agent's other tasks waits for its own turn. */
function oneTask(agent: Agent, pending: Message[]): Message[] {
  if (agent.isolation !== ISOLATION.worktree) return pending;
  const ownTask = (m: Message) => (m.taskId && getTask(m.taskId)?.assigneeId === agent.id ? m.taskId : null);
  const current = pending.map(ownTask).find(Boolean);
  return pending.filter((m) => [null, current].includes(ownTask(m)));
}

/** One broken outbox must not stop mail for every other agent. */
function collectOutbox(agent: Agent, parentId: string | null) {
  try {
    scanOutbox(agent, parentId);
  } catch (err) {
    console.error(`outbox scan failed for ${agent.name}`, err);
  }
}

/** Every hold clears by itself (unpause or next hour), so held mail never needs a manual release. */
function holdReason(agent: Agent, ws: Workspace): string | null {
  if (agent.paused) return 'agent paused';
  if (turnsLastHour(ws.id) >= ws.settings.maxTurnsPerHour) return 'turn limit per hour reached';
  return null;
}

/**
 * The agent's own engine, else its fallback while its own is out of quota, else why its mail waits.
 * A block expires at the engine's reset time, so held mail resumes by itself.
 */
export function pickEngine(agent: Agent): Engine | { hold: string } {
  const block = engineBlock(agent.engine);
  if (!block) return agent.engine;
  if (agent.fallbackEngine && !engineBlock(agent.fallbackEngine)) return agent.fallbackEngine;
  return { hold: `${block.reason}; retrying at ${new Date(block.until).toLocaleString()}` };
}

/**
 * Everything waiting for an agent goes into one turn: each turn re-reads the whole session, so three messages in
 * one turn cost far less than three turns.
 */
function start(agent: Agent, batch: Message[], team: Agent[], engine: Engine) {
  const msg = batch[0]!;
  running.add(agent.id);
  for (const m of batch) {
    setMessageStatus(m.id, MESSAGE_STATUS.running);
    emit({ type: 'message', workspaceId: agent.workspaceId, id: m.id });
  }
  const nameOf = (id: string) => (id === USER_ID || id === HUB_ID ? id : (team.find((a) => a.id === id)?.name ?? id));
  // The outbox continues the longest agent chain in the batch, so batching never resets the loop guard.
  const chainParent = batch.reduce((best, m) => (agentHops(m.id) > agentHops(best.id) ? m : best), msg);
  const taskIds = new Set(batch.map((m) => m.taskId));

  runTurn(
    agent.id,
    batch.map((message) => ({ message, fromName: nameOf(message.fromId) })),
    engine,
  )
    .then(({ run, result }) => {
      // Out of quota is not the work failing: the mail waits for the reset (or the fallback) instead.
      const retryAt = result.isError && FALLBACK_ENGINES.includes(engine) ? quotaRetryAt(result.text) : undefined;
      if (retryAt !== undefined) {
        blockEngine(engine, `${engine} quota reached`, retryAt);
        for (const m of batch) {
          setMessageStatus(m.id, MESSAGE_STATUS.queued, { runId: run.id });
          emit({ type: 'message', workspaceId: agent.workspaceId, id: m.id });
        }
        return;
      }
      for (const m of batch)
        setMessageStatus(m.id, result.isError ? MESSAGE_STATUS.failed : MESSAGE_STATUS.delivered, { runId: run.id });
      const task = msg.taskId ? getTask(msg.taskId) : undefined;
      const openRouterTaskReply =
        !result.isError && agent.engine === ENGINE.openrouter && task?.status === TASK_STATUS.doing
          ? parseTaskReply(result.text)
          : undefined;
      // The plain reply is for the human only; it never goes to another agent.
      const reply = createMessage({
        workspaceId: agent.workspaceId,
        fromId: agent.id,
        toId: USER_ID,
        act: ACT.reply,
        subject: result.isError ? 'error' : '',
        body: openRouterTaskReply?.act === 'needs_human' ? openRouterTaskReply.body : result.text,
        status: MESSAGE_STATUS.delivered,
        parentId: msg.id,
        runId: run.id,
        taskId: taskIds.size === 1 ? msg.taskId : null,
      });
      emit({ type: 'message', workspaceId: agent.workspaceId, id: reply.id });
      if (task && openRouterTaskReply && task.assigneeId === agent.id) {
        if (openRouterTaskReply.act === 'needs_human') agentAsks(task, openRouterTaskReply.body);
        else if (agentDone(task, agent.id, openRouterTaskReply.body))
          reportToDelegator(task, agent, openRouterTaskReply.body, msg.id);
      }
      if (result.isError) for (const m of batch) blockTaskOnFailure(m, agent.id, result.text);
    })
    .catch((err) => {
      const reason = String(err?.message ?? err);
      for (const m of batch) {
        setMessageStatus(m.id, MESSAGE_STATUS.failed, { holdReason: reason });
        emit({ type: 'message', workspaceId: agent.workspaceId, id: m.id });
        blockTaskOnFailure(m, agent.id, reason);
      }
    })
    .finally(() => {
      collectOutbox(agent, chainParent.id);
      running.delete(agent.id);
      tick();
    });
}

/**
 * A failed turn would otherwise leave its task "doing" forever with nobody re-sending it.
 * Blocking it puts it in the human's queue; answering it sends the agent back to work.
 */
function blockTaskOnFailure(msg: Message, agentId: string, reason: string) {
  const task = msg.taskId ? getTask(msg.taskId) : undefined;
  if (task?.status === TASK_STATUS.doing && task.assigneeId === agentId) agentAsks(task, reason);
}

export function isBusy(): boolean {
  return running.size > 0;
}

export const isAgentRunning = (agentId: string) => running.has(agentId);

/** After a crash or restart nothing is running: requeue interrupted work. */
function recover() {
  for (const ws of listWorkspaces()) {
    for (const a of listAgents(ws.id)) {
      if (a.status === AGENT_STATUS.working)
        updateAgent(a.id, { status: a.paused ? AGENT_STATUS.paused : AGENT_STATUS.idle });
    }
  }
  for (const m of failInterrupted()) blockTaskOnFailure(m, m.toId, m.holdReason ?? '');
}

/** Human asks to run a failed message again (after a crash, timeout or CLI error). */
export function retryMessage(id: string): Message {
  const msg = getMessage(id);
  if (!msg || msg.status !== MESSAGE_STATUS.failed) throw new DomainError('errors.messageNotRetryable');
  const agent = getAgent(msg.toId);
  if (!agent) throw new DomainError('errors.messageNotRetryable');
  setMessageStatus(msg.id, MESSAGE_STATUS.queued);
  detachMessage(msg.id); // the human let it through, so the loop guard starts counting again
  // The failure blocked the task; the retry is the answer, so the task goes back to work.
  const task = msg.taskId ? getTask(msg.taskId) : undefined;
  if (task?.status === TASK_STATUS.blocked && task.assigneeId === agent.id) {
    updateTask(task.id, { status: TASK_STATUS.doing, waitingReason: '' });
    emit({ type: 'task', workspaceId: task.workspaceId, id: task.id });
  }
  emit({ type: 'message', workspaceId: msg.workspaceId, id: msg.id });
  tick();
  return getMessage(msg.id)!;
}

let timer: NodeJS.Timeout | null = null;

export function startBus(intervalMs = 3000) {
  if (timer) return;
  recover();
  tick();
  timer = setInterval(tick, intervalMs);
}

export function stopBus() {
  if (timer) clearInterval(timer);
  timer = null;
}
