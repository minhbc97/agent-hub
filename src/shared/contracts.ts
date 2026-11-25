/** Domain values shared by server and UI. Compare against these, never against raw strings. */
type ValueOf<T> = T[keyof T];

/** Sender/recipient id of the human. Agents use their own ids. */
export const USER_ID = 'user';
/** Agent names keep the casing the user typed but work as case-insensitive handles (`to`, direct pairs). */
export const isSameAgentName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Sender id of messages the hub writes itself (workflow briefings). */
export const HUB_ID = 'hub';
/** createdBy of tasks started by a workflow schedule. */
export const SCHEDULER_ID = 'schedule';

export const ENGINE = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'antigravity',
  openrouter: 'openrouter',
  custom: 'custom',
} as const;
export type Engine = ValueOf<typeof ENGINE>;
export const ENGINES = Object.values(ENGINE);

export const ISOLATION = { worktree: 'worktree', shared: 'shared', custom: 'custom' } as const;
export type Isolation = ValueOf<typeof ISOLATION>;
export const ISOLATIONS = Object.values(ISOLATION);

export const RESET_POLICY = { never: 'never', turns: 'turns', context: 'context' } as const;
export type ResetPolicy = ValueOf<typeof RESET_POLICY>;
export const RESET_POLICIES = Object.values(RESET_POLICY);
/** Engines an agent can fall back to: CLIs with their own plan, files and outbox (not text-only or custom). */
export const FALLBACK_ENGINES: readonly Engine[] = [ENGINE.claude, ENGINE.codex, ENGINE.antigravity];
/** Default context size (tokens) at which the hub writes a handoff note and starts a fresh session. */
export const DEFAULT_CONTEXT_LIMIT = 100_000;

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
  /** Hold mail while the engine's plan usage is at or above this percent; 100 only stops at the limit itself. */
  quotaPausePercent: number;
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  routing: ROUTING.star,
  directPairs: [],
  maxConcurrent: 2,
  maxTurnsPerHour: 30,
  turnTimeoutMin: 30,
  maxHops: 8,
  quotaPausePercent: 100,
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
  /** Note the agent wrote for itself when the hub last rotated its session; fed into the next fresh session. */
  handoff: string;
  /** Start the CLI without the user's plugins, MCP servers and extra tools (Claude only). */
  isLean: boolean;
  /** MCP servers a lean Claude agent still loads, by the name Claude gives them (e.g. `plugin:design:atlassian`). */
  mcpServers: string[];
  /** Shell commands Claude runs without asking, with any arguments (e.g. `npm test`). */
  allowedCommands: string[];
  /** CLI engine the agent switches to while its own engine is out of quota; null = wait instead. */
  fallbackEngine: Engine | null;
  /** Model on the fallback engine; empty = that CLI's default. */
  fallbackModel: string;
  /** The engine the current session runs on when it is not `engine` (the agent is on its fallback). */
  activeEngine: Engine | null;
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
  /** Choices an agent offers with a needs_human question; the human may still answer freely. */
  options: string[];
  createdAt: string;
}

/** Bounds for needs_human options, checked when an agent's outbox is read. */
export const ASK_OPTIONS_MAX = 6;
export const ASK_OPTION_MAX_LENGTH = 160;

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
  /** Commit the task's code started from; empty until a worktree agent works on it. */
  baseCommit: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileChange {
  path: string;
  added: number;
  deleted: number;
  /** Null when the diff is too large to show. */
  patch: string | null;
}

export interface TaskChanges {
  /** Name git commands accept, e.g. `git merge <branch>`. */
  branch: string;
  files: FileChange[];
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
  /** Context size after the turn (last model call's prompt); 0 when the engine does not report it. */
  contextTokens: number;
  sessionId: string | null;
}

export const TERMINAL_KIND = {
  /** A CLI session started; text is the model when the CLI says. */
  start: 'start',
  /** A message handed to the agent for this turn. */
  input: 'input',
  text: 'text',
  thinking: 'thinking',
  /** A shell command; `tool` is any other call (reading, editing, searching). */
  shell: 'shell',
  tool: 'tool',
  output: 'output',
  error: 'error',
} as const;
export type TerminalKind = ValueOf<typeof TERMINAL_KIND>;

export interface TerminalLine {
  kind: TerminalKind;
  text: string;
}

export interface TerminalEntry extends TerminalLine {
  /** Grows by one per entry of the run, so a reader can ask only for what it has not seen. */
  seq: number;
  at: string;
}

/** Entries kept per turn, on the server and on the page. */
export const TERMINAL_MAX_ENTRIES = 500;

/** What an agent's current turn (or, when idle, its last one) printed. */
export interface TerminalOutput {
  runId: string | null;
  status: RunStatus | null;
  /** Folder the agent works in; empty when not known. */
  cwd: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Oldest entries no longer kept, because the turn printed more than the buffer holds. */
  droppedEntries: number;
  entries: TerminalEntry[];
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
  /** Whether a remote API provider has its required server configuration. */
  configured: boolean | null;
  /** Official install guide; null for engines with nothing to install. */
  installUrl: string | null;
  /** Command the user runs once in a terminal to sign the CLI in; the hub reuses that sign-in. */
  loginCommand: string | null;
  models: EngineModel[];
}

export interface Meta {
  engines: EngineInfo[];
  isolations: Agent['isolation'][];
  resetPolicies: Agent['resetPolicy'][];
  /** MCP servers found in the user's Claude Code config and plugins, for the lean-mode picker. */
  claudeMcpServers: string[];
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

/** Plan limits are per engine account (shared by every agent on that engine), not per agent. */
/** `quota`: a provider limit with no known window, known only once it is hit (Antigravity). */
export const LIMIT_WINDOW = { session: 'session', week: 'week', quota: 'quota' } as const;
export type LimitWindow = ValueOf<typeof LIMIT_WINDOW>;

export const USAGE_STATUS = {
  ok: 'ok',
  notInstalled: 'notInstalled',
  /** The engine exposes no limits the hub can read. */
  noSource: 'noSource',
  /** Readable, but nothing recorded yet (e.g. Codex before its first session). */
  noReading: 'noReading',
  /** Installed, but its CLI has no signed-in account. */
  notSignedIn: 'notSignedIn',
  error: 'error',
} as const;
export type UsageStatus = ValueOf<typeof USAGE_STATUS>;

export interface UsageWindow {
  window: LimitWindow;
  usedPercent: number;
  resetsAt: string | null;
}

export interface EngineUsage {
  engine: Engine;
  label: string;
  plan: string | null;
  status: UsageStatus;
  windows: UsageWindow[];
}

export interface UsageReport {
  takenAt: string;
  engines: EngineUsage[];
}
