import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AGENT_STATUS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_SETTINGS,
  ENGINE,
  HUB_ID,
  ISOLATION,
  MESSAGE_STATUS,
  RESET_POLICY,
  RUN_STATUS,
  TASK_STATUS,
  TRIGGER_KIND,
  USER_ID,
  type Agent,
  type Message,
  type Run,
  type Task,
  type TokenTotal,
  type Workflow,
  type Workspace,
  type MessageStatus,
} from '../shared/contracts.ts';
export { DEFAULT_SETTINGS } from '../shared/contracts.ts';
export type {
  Agent,
  Message,
  Run,
  Task,
  TaskStatus,
  Workflow,
  WorkflowStep,
  WorkflowTrigger,
  Workspace,
  WorkspaceSettings,
  Engine,
  Isolation,
  ResetPolicy,
  Act,
  MessageStatus,
} from '../shared/contracts.ts';

const dataArg = process.argv.indexOf('--data');
export const DATA_DIR = resolve(
  process.env.HUB_DATA ?? (dataArg > 0 ? process.argv[dataArg + 1] : undefined) ?? 'data',
);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, repoPath TEXT NOT NULL DEFAULT '',
  worktreesDir TEXT NOT NULL DEFAULT '', settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', briefFiles TEXT NOT NULL DEFAULT '[]',
  engine TEXT NOT NULL DEFAULT 'claude', model TEXT NOT NULL DEFAULT '', command TEXT NOT NULL DEFAULT '',
  extraArgs TEXT NOT NULL DEFAULT '', isolation TEXT NOT NULL DEFAULT 'shared', cwd TEXT NOT NULL DEFAULT '',
  isOrchestrator INTEGER NOT NULL DEFAULT 0, tint TEXT NOT NULL DEFAULT '#f6bf1d',
  avatarSeed TEXT NOT NULL DEFAULT '', dailyTokenBudget INTEGER NOT NULL DEFAULT 0,
  resetPolicy TEXT NOT NULL DEFAULT 'never', resetValue INTEGER NOT NULL DEFAULT 0,
  sessionId TEXT, turnsInSession INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  UNIQUE (workspaceId, name)
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, cron TEXT NOT NULL, agentId TEXT NOT NULL, prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, respectHours INTEGER NOT NULL DEFAULT 1, lastRunKey TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fromId TEXT NOT NULL, toId TEXT NOT NULL, act TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, holdReason TEXT, urgent INTEGER NOT NULL DEFAULT 0,
  decision TEXT, parentId TEXT, runId TEXT, createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_queue ON messages (status, toId, createdAt);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, agentId TEXT NOT NULL, messageId TEXT, startedAt TEXT NOT NULL, endedAt TEXT,
  status TEXT NOT NULL, exitCode INTEGER, output TEXT NOT NULL DEFAULT '',
  inputTokens INTEGER NOT NULL DEFAULT 0, outputTokens INTEGER NOT NULL DEFAULT 0,
  cacheWriteTokens INTEGER NOT NULL DEFAULT 0, cacheReadTokens INTEGER NOT NULL DEFAULT 0,
  costUsd REAL NOT NULL DEFAULT 0, sessionId TEXT
);
CREATE INDEX IF NOT EXISTS runs_agent ON runs (agentId, startedAt);
CREATE TABLE IF NOT EXISTS limits_snapshots (
  engine TEXT NOT NULL, window TEXT NOT NULL, usedPercent REAL NOT NULL, resetsAt TEXT,
  source TEXT NOT NULL, takenAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', steps TEXT NOT NULL DEFAULT '[]',
  trigger TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, lastRunKey TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', workflowId TEXT, stepId TEXT,
  status TEXT NOT NULL DEFAULT 'todo', assigneeId TEXT, createdBy TEXT NOT NULL DEFAULT 'user',
  result TEXT NOT NULL DEFAULT '', waitingReason TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  UNIQUE (workspaceId, key)
);
CREATE INDEX IF NOT EXISTS tasks_ws ON tasks (workspaceId, status);
`;

/** Columns added after the first release; ALTER only when missing. */
const MIGRATIONS: [table: string, column: string, ddl: string][] = [
  ['messages', 'taskId', 'ALTER TABLE messages ADD COLUMN taskId TEXT'],
  ['workspaces', 'taskSeq', 'ALTER TABLE workspaces ADD COLUMN taskSeq INTEGER NOT NULL DEFAULT 0'],
  ['agents', 'goal', "ALTER TABLE agents ADD COLUMN goal TEXT NOT NULL DEFAULT ''"],
  ['messages', 'options', "ALTER TABLE messages ADD COLUMN options TEXT NOT NULL DEFAULT '[]'"],
  ['runs', 'contextTokens', 'ALTER TABLE runs ADD COLUMN contextTokens INTEGER NOT NULL DEFAULT 0'],
  ['agents', 'isLean', 'ALTER TABLE agents ADD COLUMN isLean INTEGER NOT NULL DEFAULT 0'],
  ['agents', 'fallbackEngine', 'ALTER TABLE agents ADD COLUMN fallbackEngine TEXT'],
  ['agents', 'activeEngine', 'ALTER TABLE agents ADD COLUMN activeEngine TEXT'],
  ['agents', 'fallbackModel', "ALTER TABLE agents ADD COLUMN fallbackModel TEXT NOT NULL DEFAULT ''"],
  ['agents', 'mcpServers', "ALTER TABLE agents ADD COLUMN mcpServers TEXT NOT NULL DEFAULT '[]'"],
  ['agents', 'allowedCommands', "ALTER TABLE agents ADD COLUMN allowedCommands TEXT NOT NULL DEFAULT '[]'"],
  ['tasks', 'baseCommit', "ALTER TABLE tasks ADD COLUMN baseCommit TEXT NOT NULL DEFAULT ''"],
  // Agents saved before handoff notes existed never reset; move them to the context limit once.
  [
    'agents',
    'handoff',
    `ALTER TABLE agents ADD COLUMN handoff TEXT NOT NULL DEFAULT '';
     UPDATE agents SET resetPolicy = 'context', resetValue = ${DEFAULT_CONTEXT_LIMIT} WHERE resetPolicy = 'never';`,
  ],
];

/** Runs stored a session's running cost total; keep only what each turn added. */
const SPLIT_SESSION_COST = `
BEGIN;
UPDATE runs SET costUsd = split.cost FROM (
  SELECT id, CASE WHEN costUsd >= before THEN costUsd - before ELSE costUsd END AS cost FROM (
    SELECT id, costUsd, COALESCE(MAX(costUsd) OVER (
      PARTITION BY agentId, sessionId ORDER BY startedAt ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ), 0) AS before
    FROM runs WHERE sessionId IS NOT NULL AND costUsd > 0
  )
) AS split WHERE runs.id = split.id;
PRAGMA user_version = 1;
COMMIT;
`;

let db: DatabaseSync | null = null;

export function openDb(file = resolve(DATA_DIR, 'hub.db')): DatabaseSync {
  if (db) return db;
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  for (const [table, column, ddl] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === column)) db.exec(ddl);
  }
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version < 1) db.exec(SPLIT_SESSION_COST);
  return db;
}

export const newId = () => randomUUID().slice(0, 8);
export const now = () => new Date().toISOString();

type Row = Record<string, unknown>;

const toWorkspace = (r: Row): Workspace => ({
  ...(r as unknown as Workspace),
  settings: { ...DEFAULT_SETTINGS, ...JSON.parse(String(r.settings || '{}')) },
});

const toAgent = (r: Row): Agent => {
  const agent = { ...r };
  delete agent.dailyTokenBudget;
  return {
    ...(agent as unknown as Agent),
    briefFiles: JSON.parse(String(r.briefFiles || '[]')),
    isOrchestrator: !!r.isOrchestrator,
    isLean: !!r.isLean,
    mcpServers: JSON.parse(String(r.mcpServers || '[]')),
    allowedCommands: JSON.parse(String(r.allowedCommands || '[]')),
    paused: !!r.paused,
  };
};

const toMessage = (r: Row): Message => ({
  ...(r as unknown as Message),
  urgent: !!r.urgent,
  options: parseOptions(r.options),
});

/** Stored as JSON; anything unreadable counts as no options rather than breaking the inbox. */
function parseOptions(raw: unknown): string[] {
  try {
    const list: unknown = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(list) ? list.filter((o): o is string => typeof o === 'string') : [];
  } catch {
    return [];
  }
}

// ---- workspaces ----

export function createWorkspace(w: Partial<Workspace> & { name: string }): Workspace {
  const ws: Workspace = {
    id: w.id ?? newId(),
    name: w.name,
    repoPath: w.repoPath ?? '',
    worktreesDir: w.worktreesDir ?? '',
    settings: { ...DEFAULT_SETTINGS, ...w.settings },
  };
  openDb()
    .prepare('INSERT INTO workspaces (id, name, repoPath, worktreesDir, settings) VALUES (?, ?, ?, ?, ?)')
    .run(ws.id, ws.name, ws.repoPath, ws.worktreesDir, JSON.stringify(ws.settings));
  return ws;
}

export function getWorkspace(id: string): Workspace | undefined {
  const r = openDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Row | undefined;
  return r && toWorkspace(r);
}

export function updateWorkspace(id: string, patch: Partial<Omit<Workspace, 'id'>>): void {
  const cur = getWorkspace(id);
  if (!cur) return;
  const next = {
    ...cur,
    ...patch,
    settings: { ...cur.settings, ...patch.settings },
  };
  openDb()
    .prepare('UPDATE workspaces SET name = ?, repoPath = ?, worktreesDir = ?, settings = ? WHERE id = ?')
    .run(next.name, next.repoPath, next.worktreesDir, JSON.stringify(next.settings), id);
}

export function deleteWorkspace(id: string): void {
  const d = openDb();
  d.prepare('DELETE FROM runs WHERE agentId IN (SELECT id FROM agents WHERE workspaceId = ?)').run(id);
  d.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
}

export function listWorkspaces(): Workspace[] {
  return (openDb().prepare('SELECT * FROM workspaces ORDER BY name COLLATE NOCASE').all() as Row[]).map(toWorkspace);
}

// ---- agents ----

export function createAgent(a: Partial<Agent> & { workspaceId: string; name: string }): Agent {
  const agent: Agent = {
    id: newId(),
    role: '',
    goal: '',
    briefFiles: [],
    engine: ENGINE.claude,
    model: '',
    command: '',
    extraArgs: '',
    isolation: ISOLATION.worktree,
    cwd: '',
    isOrchestrator: false,
    tint: '#f6bf1d',
    avatarSeed: a.name,
    resetPolicy: RESET_POLICY.context,
    resetValue: DEFAULT_CONTEXT_LIMIT,
    handoff: '',
    isLean: false,
    mcpServers: [],
    allowedCommands: [],
    fallbackEngine: null,
    fallbackModel: '',
    activeEngine: null,
    sessionId: null,
    turnsInSession: 0,
    paused: false,
    status: AGENT_STATUS.idle,
    ...a,
    name: a.name.trim(),
  };
  openDb()
    .prepare(
      `INSERT INTO agents (id, workspaceId, name, role, goal, briefFiles, engine, model, command, extraArgs,
        isolation, cwd, isOrchestrator, tint, avatarSeed, resetPolicy, resetValue, handoff, isLean, mcpServers, allowedCommands, fallbackEngine, fallbackModel, activeEngine,
        sessionId, turnsInSession, paused, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      agent.id,
      agent.workspaceId,
      agent.name,
      agent.role,
      agent.goal,
      JSON.stringify(agent.briefFiles),
      agent.engine,
      agent.model,
      agent.command,
      agent.extraArgs,
      agent.isolation,
      agent.cwd,
      agent.isOrchestrator ? 1 : 0,
      agent.tint,
      agent.avatarSeed,
      agent.resetPolicy,
      agent.resetValue,
      agent.handoff,
      agent.isLean ? 1 : 0,
      JSON.stringify(agent.mcpServers),
      JSON.stringify(agent.allowedCommands),
      agent.fallbackEngine,
      agent.fallbackModel,
      agent.activeEngine,
      agent.sessionId,
      agent.turnsInSession,
      agent.paused ? 1 : 0,
      agent.status,
    );
  if (agent.isOrchestrator) keepOnlyOrchestrator(agent);
  return agent;
}

export function getAgent(id: string): Agent | undefined {
  const r = openDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as Row | undefined;
  return r && toAgent(r);
}

export function listAgents(workspaceId: string): Agent[] {
  return (openDb().prepare('SELECT * FROM agents WHERE workspaceId = ? ORDER BY rowid').all(workspaceId) as Row[]).map(
    toAgent,
  );
}

const AGENT_COLUMNS = new Set([
  'name',
  'role',
  'goal',
  'briefFiles',
  'engine',
  'model',
  'command',
  'extraArgs',
  'isolation',
  'cwd',
  'isOrchestrator',
  'tint',
  'avatarSeed',
  'resetPolicy',
  'resetValue',
  'handoff',
  'isLean',
  'mcpServers',
  'allowedCommands',
  'fallbackEngine',
  'fallbackModel',
  'activeEngine',
  'sessionId',
  'turnsInSession',
  'paused',
  'status',
]);

export function updateAgent(id: string, patch: Partial<Agent>): void {
  const entries = Object.entries(patch).filter(([k]) => AGENT_COLUMNS.has(k));
  if (!entries.length) return;
  // Only identity changes touch other rows; status updates (every turn) skip this lookup.
  const before = patch.name !== undefined || patch.isOrchestrator ? getAgent(id) : undefined;
  const values = entries.map(([, v]) =>
    Array.isArray(v) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null),
  );
  openDb()
    .prepare(`UPDATE agents SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...values, id);
  if (!before) return;
  if (patch.isOrchestrator) keepOnlyOrchestrator(before);
  if (patch.name !== undefined && patch.name !== before.name) {
    rewritePairs(before.workspaceId, ([x, y]) => [
      x === before.name ? patch.name! : x,
      y === before.name ? patch.name! : y,
    ]);
  }
}

/** A workspace has at most one orchestrator. */
function keepOnlyOrchestrator(agent: Agent) {
  openDb()
    .prepare('UPDATE agents SET isOrchestrator = 0 WHERE workspaceId = ? AND id != ?')
    .run(agent.workspaceId, agent.id);
}

/** Direct-message pairs are stored by agent name, so renames and deletes must follow. */
function rewritePairs(workspaceId: string, map: (pair: [string, string]) => [string, string] | null) {
  const ws = getWorkspace(workspaceId);
  if (!ws) return;
  const directPairs = ws.settings.directPairs.map(map).filter((p): p is [string, string] => p !== null);
  updateWorkspace(ws.id, { settings: { ...ws.settings, directPairs } });
}

export function deleteAgent(id: string): void {
  const d = openDb();
  const agent = getAgent(id);
  if (agent) rewritePairs(agent.workspaceId, (p) => (p.includes(agent.name) ? null : p));
  d.prepare('DELETE FROM runs WHERE agentId = ?').run(id);
  d.prepare('DELETE FROM missions WHERE agentId = ?').run(id);
  // Keep the conversation history; just drop work still waiting for this agent.
  d.prepare(
    `UPDATE messages SET status = 'failed', holdReason = 'agent deleted' WHERE toId = ? AND status IN ('queued', 'held')`,
  ).run(id);
  d.prepare(`UPDATE tasks SET assigneeId = NULL WHERE assigneeId = ?`).run(id);
  d.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

/** Token totals per agent since a given time (for cards and sidebars). */
export function tokenTotals(workspaceId: string, sinceIso: string): TokenTotal[] {
  return openDb()
    .prepare(
      `SELECT agentId, COUNT(*) AS turns, SUM(inputTokens) AS inputTokens, SUM(outputTokens) AS outputTokens,
        SUM(cacheWriteTokens) AS cacheWriteTokens, SUM(cacheReadTokens) AS cacheReadTokens, SUM(costUsd) AS costUsd
       FROM runs JOIN agents ON agents.id = runs.agentId
       WHERE agents.workspaceId = ? AND runs.startedAt >= ? GROUP BY agentId`,
    )
    .all(workspaceId, sinceIso) as unknown as TokenTotal[];
}

// ---- messages ----

export function createMessage(
  m: Pick<Message, 'workspaceId' | 'fromId' | 'toId' | 'act' | 'body'> & Partial<Message>,
): Message {
  const msg: Message = {
    id: newId(),
    subject: '',
    status: MESSAGE_STATUS.queued,
    holdReason: null,
    urgent: false,
    decision: null,
    parentId: null,
    runId: null,
    taskId: null,
    options: [],
    createdAt: now(),
    ...m,
  };
  openDb()
    .prepare(
      `INSERT INTO messages (id, workspaceId, fromId, toId, act, subject, body, status, holdReason, urgent,
        decision, parentId, runId, taskId, options, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.id,
      msg.workspaceId,
      msg.fromId,
      msg.toId,
      msg.act,
      msg.subject,
      msg.body,
      msg.status,
      msg.holdReason,
      msg.urgent ? 1 : 0,
      msg.decision,
      msg.parentId,
      msg.runId,
      msg.taskId,
      JSON.stringify(msg.options),
      msg.createdAt,
    );
  return msg;
}

// ---- workflows ----

const toWorkflow = (r: Row): Workflow => ({
  ...(r as unknown as Workflow),
  steps: JSON.parse(String(r.steps || '[]')),
  trigger: {
    kind: TRIGGER_KIND.manual,
    cron: '',
    title: '',
    body: '',
    ...JSON.parse(String(r.trigger || '{}')),
  },
  enabled: !!r.enabled,
});

export function listWorkflows(workspaceId: string): Workflow[] {
  return (
    openDb().prepare('SELECT * FROM workflows WHERE workspaceId = ? ORDER BY createdAt').all(workspaceId) as Row[]
  ).map(toWorkflow);
}

export function allWorkflows(): Workflow[] {
  return (openDb().prepare('SELECT * FROM workflows').all() as Row[]).map(toWorkflow);
}

export function getWorkflow(id: string): Workflow | undefined {
  const r = openDb().prepare('SELECT * FROM workflows WHERE id = ?').get(id) as Row | undefined;
  return r && toWorkflow(r);
}

export function saveWorkflow(w: Omit<Workflow, 'id' | 'createdAt' | 'lastRunKey'> & { id?: string }): Workflow {
  const d = openDb();
  if (w.id && getWorkflow(w.id)) {
    d.prepare('UPDATE workflows SET name = ?, description = ?, steps = ?, trigger = ?, enabled = ? WHERE id = ?').run(
      w.name,
      w.description,
      JSON.stringify(w.steps),
      JSON.stringify(w.trigger),
      w.enabled ? 1 : 0,
      w.id,
    );
    return getWorkflow(w.id)!;
  }
  const id = newId();
  d.prepare(
    'INSERT INTO workflows (id, workspaceId, name, description, steps, trigger, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    w.workspaceId,
    w.name,
    w.description,
    JSON.stringify(w.steps),
    JSON.stringify(w.trigger),
    w.enabled ? 1 : 0,
    now(),
  );
  return getWorkflow(id)!;
}

export function setWorkflowRunKey(id: string, key: string) {
  openDb().prepare('UPDATE workflows SET lastRunKey = ? WHERE id = ?').run(key, id);
}

export function deleteWorkflow(id: string) {
  openDb().prepare(`UPDATE tasks SET workflowId = NULL, stepId = NULL WHERE workflowId = ?`).run(id);
  openDb().prepare('DELETE FROM workflows WHERE id = ?').run(id);
}

// ---- tasks ----

export function listTasks(workspaceId: string): Task[] {
  return openDb()
    .prepare('SELECT * FROM tasks WHERE workspaceId = ? ORDER BY updatedAt DESC')
    .all(workspaceId) as unknown as Task[];
}

export function getTask(id: string): Task | undefined {
  return openDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as Task | undefined;
}

export function findTaskByKey(workspaceId: string, key: string): Task | undefined {
  return openDb()
    .prepare('SELECT * FROM tasks WHERE workspaceId = ? AND key = ? COLLATE NOCASE')
    .get(workspaceId, key.trim()) as unknown as Task | undefined;
}

export function createTask(t: Pick<Task, 'workspaceId' | 'title'> & Partial<Task>): Task {
  const d = openDb();
  // Keys are never reused, even after deletes: an agent may still report on an old key.
  // The MAX(...) covers databases created before the counter column existed.
  const { seq } = d
    .prepare(
      `UPDATE workspaces SET taskSeq = MAX(taskSeq, (SELECT COALESCE(MAX(CAST(substr(key, 3) AS INTEGER)), 0)
        FROM tasks WHERE workspaceId = ?)) + 1 WHERE id = ? RETURNING taskSeq AS seq`,
    )
    .get(t.workspaceId, t.workspaceId) as { seq: number };
  const task: Task = {
    id: newId(),
    key: `T-${seq}`,
    body: '',
    workflowId: null,
    stepId: null,
    status: TASK_STATUS.todo,
    assigneeId: null,
    createdBy: USER_ID,
    result: '',
    waitingReason: '',
    baseCommit: '',
    createdAt: now(),
    updatedAt: now(),
    ...t,
  };
  d.prepare(
    `INSERT INTO tasks (id, workspaceId, key, title, body, workflowId, stepId, status, assigneeId, createdBy, result,
      waitingReason, baseCommit, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    task.id,
    task.workspaceId,
    task.key,
    task.title,
    task.body,
    task.workflowId,
    task.stepId,
    task.status,
    task.assigneeId,
    task.createdBy,
    task.result,
    task.waitingReason,
    task.baseCommit,
    task.createdAt,
    task.updatedAt,
  );
  return task;
}

const TASK_COLUMNS = new Set([
  'title',
  'body',
  'workflowId',
  'stepId',
  'status',
  'assigneeId',
  'result',
  'waitingReason',
  'baseCommit',
]);

export function updateTask(id: string, patch: Partial<Task>): Task | undefined {
  const entries = Object.entries(patch).filter(([k]) => TASK_COLUMNS.has(k));
  if (entries.length) {
    openDb()
      .prepare(`UPDATE tasks SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updatedAt = ? WHERE id = ?`)
      .run(...entries.map(([, v]) => v as string | null), now(), id);
  }
  return getTask(id);
}

export function deleteTask(id: string) {
  openDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function setMessageStatus(
  id: string,
  status: MessageStatus,
  extra: { runId?: string; holdReason?: string | null } = {},
) {
  openDb()
    .prepare('UPDATE messages SET status = ?, runId = COALESCE(?, runId), holdReason = ? WHERE id = ?')
    .run(status, extra.runId ?? null, extra.holdReason ?? null, id);
}

/**
 * The human wrote to an agent: its open questions that no task is waiting on count as answered. A question
 * whose task already moved on (done, archived, back to work) is answered here too, as the inbox shows it as loose.
 */
export function resolveLooseQuestions(workspaceId: string, agentId: string): void {
  openDb()
    .prepare(
      `UPDATE messages SET status = 'delivered', holdReason = NULL WHERE workspaceId = ? AND fromId = ?
        AND act = 'needs_human' AND status = 'held'
        AND (taskId IS NULL OR taskId NOT IN (SELECT id FROM tasks WHERE status IN ('blocked', 'review')))`,
    )
    .run(workspaceId, agentId);
}

const INTERRUPTED = 'interrupted by hub restart';

/**
 * After a restart nothing is running. An interrupted turn may have left half-done edits behind, so it is
 * failed rather than silently rerun; the human retries it. Returns the interrupted messages.
 */
export function failInterrupted(): Message[] {
  const d = openDb();
  const rows = (d.prepare(`SELECT * FROM messages WHERE status = 'running'`).all() as Row[]).map(toMessage);
  d.prepare(`UPDATE messages SET status = 'failed', holdReason = ? WHERE status = 'running'`).run(INTERRUPTED);
  d.prepare(`UPDATE runs SET status = 'failed', output = ? WHERE status = 'running'`).run(INTERRUPTED);
  return rows.map((m) => ({ ...m, status: MESSAGE_STATUS.failed, holdReason: INTERRUPTED }));
}

/** How many agent-written messages lead to this one since the last human or hub message (the loop guard). */
export function agentHops(messageId: string): number {
  const r = openDb()
    .prepare(
      `WITH RECURSIVE chain(id, parentId, fromId) AS (
         SELECT id, parentId, fromId FROM messages WHERE id = ?
         UNION ALL SELECT m.id, m.parentId, m.fromId FROM messages m JOIN chain c ON m.id = c.parentId)
       SELECT COUNT(*) AS n FROM chain WHERE fromId NOT IN (?, ?)`,
    )
    .get(messageId, USER_ID, HUB_ID) as { n: number };
  return r.n;
}

/** The human released a message: it starts a fresh chain, so the loop guard counts from zero again. */
export function detachMessage(id: string): void {
  openDb().prepare('UPDATE messages SET parentId = NULL WHERE id = ?').run(id);
}

export function getMessage(id: string): Message | undefined {
  const r = openDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined;
  return r ? toMessage(r) : undefined;
}

export function listMessages(workspaceId: string, limit = 200): Message[] {
  return (
    openDb()
      .prepare(
        'SELECT * FROM (SELECT rowid AS seq, * FROM messages WHERE workspaceId = ? ORDER BY createdAt DESC, seq DESC LIMIT ?) ORDER BY createdAt, seq',
      )
      .all(workspaceId, limit) as Row[]
  ).map(toMessage);
}

/** Messages waiting for an agent, oldest first, urgent ones ahead. */
export function pendingFor(agentId: string): Message[] {
  return (
    openDb()
      .prepare(
        `SELECT * FROM messages WHERE toId = ? AND status IN ('queued', 'held') ORDER BY urgent DESC, createdAt, rowid`,
      )
      .all(agentId) as Row[]
  ).map(toMessage);
}

// ---- runs ----

export function createRun(agentId: string, messageId: string | null): Run {
  const run: Run = {
    id: newId(),
    agentId,
    messageId,
    startedAt: now(),
    endedAt: null,
    status: RUN_STATUS.running,
    exitCode: null,
    output: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    contextTokens: 0,
    sessionId: null,
  };
  openDb()
    .prepare('INSERT INTO runs (id, agentId, messageId, startedAt, status) VALUES (?, ?, ?, ?, ?)')
    .run(run.id, agentId, messageId, run.startedAt, run.status);
  return run;
}

/** The agent's latest finished turn in this session, which tells the next turn whether to rotate it. */
export function lastSessionRun(agentId: string, sessionId: string): Run | undefined {
  return openDb()
    .prepare(
      `SELECT * FROM runs WHERE agentId = ? AND sessionId = ? AND status != 'running' ORDER BY endedAt DESC LIMIT 1`,
    )
    .get(agentId, sessionId) as Run | undefined;
}

/** Mail the session has already read, which tells whether it knows a task's brief. */
export function sessionMail(agentId: string, sessionId: string): Message[] {
  return (
    openDb()
      .prepare(
        `SELECT messages.* FROM messages JOIN runs ON runs.id = messages.runId
         WHERE messages.toId = ? AND runs.agentId = ? AND runs.sessionId = ? AND runs.status = ?`,
      )
      .all(agentId, agentId, sessionId, RUN_STATUS.ok) as Row[]
  ).map(toMessage);
}

/** Whether the agent was ever given mail about the task in a turn. */
export function wasMailedTask(agentId: string, taskId: string): boolean {
  return !!openDb()
    .prepare('SELECT 1 FROM messages WHERE toId = ? AND taskId = ? AND runId IS NOT NULL LIMIT 1')
    .get(agentId, taskId);
}

/** Token totals already recorded for one session, used to turn a CLI's running total into per-turn usage. */
export function sessionUsage(agentId: string, sessionId: string) {
  return openDb()
    .prepare(
      `SELECT COALESCE(SUM(inputTokens), 0) AS inputTokens, COALESCE(SUM(outputTokens), 0) AS outputTokens,
        COALESCE(SUM(cacheWriteTokens), 0) AS cacheWriteTokens, COALESCE(SUM(cacheReadTokens), 0) AS cacheReadTokens,
        COALESCE(SUM(costUsd), 0) AS costUsd
       FROM runs WHERE agentId = ? AND sessionId = ? AND status != 'running'`,
    )
    .get(agentId, sessionId) as Record<
    'inputTokens' | 'outputTokens' | 'cacheWriteTokens' | 'cacheReadTokens' | 'costUsd',
    number
  >;
}

export function finishRun(run: Run): void {
  openDb()
    .prepare(
      `UPDATE runs SET endedAt = ?, status = ?, exitCode = ?, output = ?, inputTokens = ?, outputTokens = ?,
        cacheWriteTokens = ?, cacheReadTokens = ?, costUsd = ?, contextTokens = ?, sessionId = ? WHERE id = ?`,
    )
    .run(
      run.endedAt,
      run.status,
      run.exitCode,
      run.output,
      run.inputTokens,
      run.outputTokens,
      run.cacheWriteTokens,
      run.cacheReadTokens,
      run.costUsd,
      run.contextTokens,
      run.sessionId,
      run.id,
    );
}

export function listRuns(agentId: string, limit = 50): Run[] {
  return openDb()
    .prepare('SELECT * FROM runs WHERE agentId = ? ORDER BY startedAt DESC LIMIT ?')
    .all(agentId, limit) as unknown as Run[];
}

/** Turns started in the workspace during the last hour (rate guard). */
export function turnsLastHour(workspaceId: string): number {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const r = openDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM runs JOIN agents ON agents.id = runs.agentId
       WHERE agents.workspaceId = ? AND runs.startedAt >= ?`,
    )
    .get(workspaceId, since) as { n: number };
  return r.n;
}
