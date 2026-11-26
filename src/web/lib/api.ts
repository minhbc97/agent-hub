import type {
  McpServerInput,
  Agent,
  Message,
  Meta,
  Run,
  Task,
  TaskChanges,
  TerminalOutput,
  TokenTotal,
  UsageReport,
  Workflow,
  WorkflowInput,
  Workspace,
  WorkspaceSettings,
} from '../../shared/contracts.ts';
import { t } from '@/lib/i18n';

export {
  ACT,
  AGENT_STATUS,
  DECISION,
  DEFAULT_CONTEXT_LIMIT,
  ENGINE,
  ENGINES,
  FALLBACK_ENGINES,
  HUB_ID,
  isSameAgentName,
  ISOLATION,
  ISOLATIONS,
  MCP_ENGINES,
  MCP_TRANSPORT,
  MESSAGE_STATUS,
  RESET_POLICIES,
  RESET_POLICY,
  ROUTING,
  RUN_STATUS,
  TASK_STATUS,
  TERMINAL_KIND,
  TERMINAL_MAX_ENTRIES,
  TRIGGER_KIND,
  USAGE_STATUS,
  USER_ID,
  workTokens,
} from '../../shared/contracts.ts';

export type {
  Engine,
  McpServerInput,
  McpTransport,
  AgentStatus,
  Routing,
  Agent,
  EngineInfo,
  Message,
  Meta,
  Run,
  FileChange,
  Task,
  TaskChanges,
  TaskStatus,
  TerminalEntry,
  TerminalKind,
  TerminalOutput,
  TokenTotal,
  EngineUsage,
  UsageReport,
  UsageWindow,
  Workflow,
  WorkflowInput,
  WorkflowStep,
  WorkflowTrigger,
  Workspace,
  WorkspaceSettings,
} from '../../shared/contracts.ts';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data as { error?: string; errorKey?: string; errorParams?: Record<string, string | number> } | null;
    throw new Error(error?.errorKey ? t(error.errorKey, error.errorParams) : (error?.error ?? `HTTP ${res.status}`));
  }
  return data as T;
}

export const api = {
  meta: () => call<Meta>('GET', '/api/meta'),
  workspaceGit: (ws: string) => call<{ hasGit: boolean }>('GET', `/api/workspaces/${ws}/git`),
  usage: (refresh = false) => call<UsageReport>('GET', refresh ? '/api/usage?refresh' : '/api/usage'),
  pickFolder: () => call<{ path: string | null }>('POST', '/api/folders/pick'),
  addMcpServer: (server: McpServerInput) => call('POST', '/api/mcp-servers', server),

  workspaces: () => call<Workspace[]>('GET', '/api/workspaces'),
  createWorkspace: (w: Partial<Workspace>) => call<Workspace>('POST', '/api/workspaces', w),
  updateWorkspace: (
    id: string,
    w: Partial<Omit<Workspace, 'settings'>> & {
      settings?: Partial<WorkspaceSettings>;
    },
  ) => call<Workspace>('PATCH', `/api/workspaces/${id}`, w),
  deleteWorkspace: (id: string) => call('DELETE', `/api/workspaces/${id}`),

  agents: (ws: string) => call<Agent[]>('GET', `/api/workspaces/${ws}/agents`),
  createAgent: (ws: string, a: Partial<Agent>) => call<Agent>('POST', `/api/workspaces/${ws}/agents`, a),
  updateAgent: (id: string, a: Partial<Agent>) => call<Agent>('PATCH', `/api/agents/${id}`, a),
  deleteAgent: (id: string) => call('DELETE', `/api/agents/${id}`),
  newSession: (id: string) => call<Agent>('POST', `/api/agents/${id}/new-session`),
  stopAgent: (id: string) => call('POST', `/api/agents/${id}/stop`),
  testAgent: (id: string) => call<Message>('POST', `/api/agents/${id}/test`),
  runs: (id: string) => call<Run[]>('GET', `/api/agents/${id}/runs`),

  terminal: (id: string, runId: string, afterSeq: number) =>
    call<TerminalOutput>('GET', `/api/agents/${id}/terminal?run=${runId}&after=${afterSeq}`),

  messages: (ws: string) => call<Message[]>('GET', `/api/workspaces/${ws}/messages`),
  send: (
    ws: string,
    m: {
      to: string;
      body: string;
      subject?: string;
      urgent?: boolean;
      taskId?: string;
    },
  ) => call<Message>('POST', `/api/workspaces/${ws}/messages`, m),
  retryMessage: (id: string) => call<Message>('POST', `/api/messages/${id}/retry`),
  tokens: (ws: string) => call<TokenTotal[]>('GET', `/api/workspaces/${ws}/tokens`),

  tasks: (ws: string) => call<Task[]>('GET', `/api/workspaces/${ws}/tasks`),
  createTask: (
    ws: string,
    t: {
      title: string;
      body?: string;
      workflowId?: string | null;
      assigneeId?: string | null;
      start?: boolean;
    },
  ) => call<Task>('POST', `/api/workspaces/${ws}/tasks`, t),
  updateTask: (id: string, t: Partial<Pick<Task, 'title' | 'body' | 'status' | 'assigneeId'>>) =>
    call<Task>('PATCH', `/api/tasks/${id}`, t),
  taskChanges: (id: string) => call<TaskChanges | null>('GET', `/api/tasks/${id}/changes`),
  deleteTask: (id: string) => call('DELETE', `/api/tasks/${id}`),
  startTask: (id: string, note?: string) => call<Task>('POST', `/api/tasks/${id}/start`, { note }),
  decide: (id: string, approve: boolean, note: string) =>
    call<Task>('POST', `/api/tasks/${id}/decision`, { approve, note }),
  answer: (id: string, body: string) => call<Task>('POST', `/api/tasks/${id}/answer`, { body }),

  workflows: (ws: string) => call<Workflow[]>('GET', `/api/workspaces/${ws}/workflows`),
  createWorkflow: (ws: string, w: WorkflowInput) => call<Workflow>('POST', `/api/workspaces/${ws}/workflows`, w),
  updateWorkflow: (id: string, w: Partial<WorkflowInput>) => call<Workflow>('PATCH', `/api/workflows/${id}`, w),
  deleteWorkflow: (id: string) => call('DELETE', `/api/workflows/${id}`),
  runWorkflow: (id: string, title: string, body: string) =>
    call<Task>('POST', `/api/workflows/${id}/run`, { title, body }),
  cronPreview: (cron: string) => call<{ next: string[] }>('POST', '/api/cron/preview', { cron }),
};
