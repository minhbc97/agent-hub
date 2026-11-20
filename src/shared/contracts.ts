/** Domain values shared by server and UI. Compare against these, never against raw strings. */
type ValueOf<T> = T[keyof T];

/** Sender/recipient id of the human. Agents use their own ids. */
export const USER_ID = 'user';
/** Sender id of messages the hub writes itself (workflow briefings). */
export const HUB_ID = 'hub';
/** createdBy of tasks started by a workflow schedule. */
export const SCHEDULER_ID = 'schedule';

export const ENGINE = { claude: 'claude', codex: 'codex', antigravity: 'antigravity', custom: 'custom' } as const;
export type Engine = ValueOf<typeof ENGINE>;
export const ENGINES = Object.values(ENGINE);

export const ISOLATION = { worktree: 'worktree', shared: 'shared', custom: 'custom' } as const;
export type Isolation = ValueOf<typeof ISOLATION>;
export const ISOLATIONS = Object.values(ISOLATION);

export const RESET_POLICY = { never: 'never', turns: 'turns', context: 'context' } as const;
export type ResetPolicy = ValueOf<typeof RESET_POLICY>;
export const RESET_POLICIES = Object.values(RESET_POLICY);

export const ACT = {
  request: 'request',
  query: 'query',
  inform: 'inform',
  done: 'done',
  needsHuman: 'needs_human',
  reply: 'reply',
} as const;
export type Act = ValueOf<typeof ACT>;

export const MESSAGE_STATUS = {
  queued: 'queued',
  held: 'held',
  running: 'running',
  delivered: 'delivered',
  failed: 'failed',
} as const;
export type MessageStatus = ValueOf<typeof MESSAGE_STATUS>;

export const AGENT_STATUS = { idle: 'idle', working: 'working', paused: 'paused', held: 'held' } as const;
export type AgentStatus = ValueOf<typeof AGENT_STATUS>;

export const TASK_STATUS = {
  todo: 'todo',
  doing: 'doing',
  review: 'review',
  blocked: 'blocked',
  done: 'done',
  archived: 'archived',
} as const;
export type TaskStatus = ValueOf<typeof TASK_STATUS>;
export const TASK_STATUSES = Object.values(TASK_STATUS);

export const RUN_STATUS = { running: 'running', ok: 'ok', failed: 'failed' } as const;
export type RunStatus = ValueOf<typeof RUN_STATUS>;

export const ROUTING = { star: 'star', mesh: 'mesh' } as const;
export type Routing = ValueOf<typeof ROUTING>;

export const TRIGGER_KIND = { manual: 'manual', schedule: 'schedule' } as const;
export type TriggerKind = ValueOf<typeof TRIGGER_KIND>;

export const DECISION = { approve: 'approve', reject: 'reject' } as const;
export type Decision = ValueOf<typeof DECISION>;

export interface WorkspaceSettings {
  routing: Routing;
  /** Agent-name pairs allowed to talk directly when routing is mesh. */
  directPairs: [string, string][];
  maxConcurrent: number;
  maxTurnsPerHour: number;
  turnTimeoutMin: number;
  /** Agent-to-agent messages allowed in one chain before a human must step in (stops ping-pong loops). */
  maxHops: number;
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  routing: ROUTING.star,
  directPairs: [],
  maxConcurrent: 2,
  maxTurnsPerHour: 30,
  turnTimeoutMin: 30,
  maxHops: 8,
};

export interface Workspace {
  id: string;
  name: string;
  repoPath: string;
  worktreesDir: string;
  settings: WorkspaceSettings;
}

export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  goal: string;
  briefFiles: string[];
  engine: Engine;
  model: string;
  command: string;
  extraArgs: string;
  isolation: Isolation;
  cwd: string;
  isOrchestrator: boolean;
  tint: string;
  avatarSeed: string;
  resetPolicy: ResetPolicy;
  resetValue: number;
  sessionId: string | null;
  turnsInSession: number;
  paused: boolean;
  status: AgentStatus;
}

export interface Message {
  id: string;
  workspaceId: string;
  fromId: string;
  toId: string;
  act: Act;
  subject: string;
  body: string;
  status: MessageStatus;
  holdReason: string | null;
  urgent: boolean;
  decision: Decision | null;
  parentId: string | null;
  runId: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  agentId: string | null;
  instruction: string;
  /** Human must approve the result before the task moves on. */
  approval: boolean;
  /** Where a rejected result goes back to (default: this step). */
  onReject: string | null;
}

export interface WorkflowTrigger {
  kind: TriggerKind;
  cron: string;
  /** Title for tasks created by the schedule; {date} is replaced. */
  title: string;
  body: string;
}

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  trigger: WorkflowTrigger;
  enabled: boolean;
  lastRunKey: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  key: string;
  title: string;
  body: string;
  workflowId: string | null;
  stepId: string | null;
  status: TaskStatus;
  /** Agent id, USER_ID, or null. */
  assigneeId: string | null;
  createdBy: string;
  /** Latest result handed in for the current step. */
  result: string;
  /** Why the task waits on the human (question or approval note). */
  waitingReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  agentId: string;
  messageId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
  exitCode: number | null;
  output: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  sessionId: string | null;
}

export interface EngineModel {
  id: string;
  label: string;
}

export interface EngineInfo {
  id: Engine;
  label: string;
  supported: boolean;
  /** Binary the form fills in when this engine is picked; empty for custom. */
  defaultCommand: string;
  /** Flags a new agent on this engine starts with (e.g. permission mode). */
  defaultExtraArgs: string;
  /** Whether defaultCommand resolves on PATH; null when the check could not tell. */
  installed: boolean | null;
  models: EngineModel[];
}

export interface Meta {
  engines: EngineInfo[];
  isolations: Agent['isolation'][];
  resetPolicies: Agent['resetPolicy'][];
  defaults: WorkspaceSettings;
}

export interface TokenTotal {
  agentId: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

/**
 * Tokens the model actually processed for the work: input, output and new cache writes.
 * Cache reads are left out: they repeat the session context every turn and would dwarf everything else.
 */
export const workTokens = (t: Pick<TokenTotal, 'inputTokens' | 'outputTokens' | 'cacheWriteTokens'>) =>
  t.inputTokens + t.outputTokens + t.cacheWriteTokens;

export type WorkflowInput = Pick<Workflow, 'name' | 'description' | 'steps' | 'trigger' | 'enabled'>;
