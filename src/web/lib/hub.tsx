import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ACT,
  AGENT_STATUS,
  MESSAGE_STATUS,
  TASK_STATUS,
  api,
  type Agent,
  type AgentStatus,
  type Message,
  type Meta,
  type Task,
  type TokenTotal,
  type Workflow,
  type Workspace,
} from './api.ts';
import { t } from './i18n.ts';
import { qk } from './query.ts';

/** A message the user just sent, shown at once until the server has it (or the send fails). */
export interface OutgoingMessage {
  key: string;
  toId: string;
  body: string;
  taskId: string | null;
  createdAt: string;
}

type SendInput = Parameters<typeof api.send>[1];

interface Hub {
  ready: boolean;
  meta: Meta | null;
  workspaces: Workspace[];
  ws: Workspace | null;
  agents: Agent[];
  messages: Message[];
  tasks: Task[];
  workflows: Workflow[];
  tokens: TokenTotal[];
  selectWorkspace: (id: string) => void;
  reload: () => Promise<void>;
  /** Re-read engines and MCP servers, e.g. after the user added a server to a CLI. */
  reloadMeta: () => Promise<void>;
  /** Run an API call; on failure show its message as a toast. Returns undefined on error. */
  attempt: <T>(fn: () => Promise<T>, ok?: string) => Promise<T | undefined>;
  outgoing: OutgoingMessage[];
  /** Sends as the user with an optimistic row; resolves false when the send failed. */
  sendMessage: (input: SendInput) => Promise<boolean>;
  agentById: (id: string | null | undefined) => Agent | undefined;
  /** Call back when an agent printed something; returns the unsubscribe function. */
  onTerminalOutput: (listener: TerminalListener) => () => void;
}

type TerminalListener = (agentId: string) => void;

const Ctx = createContext<Hub | null>(null);
const WS_KEY = 'agent-hub.workspace';

function readWs(): string | null {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}

function useQueryErrorToast(error: unknown) {
  useEffect(() => {
    if (error) toast.error(error instanceof Error ? error.message : String(error));
  }, [error]);
}

export function HubProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [wsId, setWsId] = useState<string | null>(readWs);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const terminalListeners = useRef(new Set<TerminalListener>());
  const wsRef = useRef(wsId);
  wsRef.current = wsId;
  const metaQuery = useQuery({ queryKey: qk.meta, queryFn: api.meta });
  const workspacesQuery = useQuery({ queryKey: qk.workspaces, queryFn: api.workspaces });
  const workspaces = workspacesQuery.data ?? [];
  const ws = workspaces.find((workspace) => workspace.id === wsId) ?? null;
  const queryWsId = ws?.id ?? '';
  const agentsQuery = useQuery({
    queryKey: qk.agents(queryWsId),
    queryFn: () => api.agents(queryWsId),
    enabled: !!ws,
    staleTime: Infinity,
  });
  const messagesQuery = useQuery({
    queryKey: qk.messages(queryWsId),
    queryFn: () => api.messages(queryWsId),
    enabled: !!ws,
    staleTime: Infinity,
  });
  const tasksQuery = useQuery({
    queryKey: qk.tasks(queryWsId),
    queryFn: () => api.tasks(queryWsId),
    enabled: !!ws,
    staleTime: Infinity,
  });
  const workflowsQuery = useQuery({
    queryKey: qk.workflows(queryWsId),
    queryFn: () => api.workflows(queryWsId),
    enabled: !!ws,
    staleTime: Infinity,
  });
  const tokensQuery = useQuery({
    queryKey: qk.tokens(queryWsId),
    queryFn: () => api.tokens(queryWsId),
    enabled: !!ws,
    staleTime: Infinity,
  });
  const agents = agentsQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const workflows = workflowsQuery.data ?? [];
  const tokens = tokensQuery.data ?? [];
  const hasValidWorkspaceSelection = wsId === null ? workspaces.length === 0 : !!ws;
  const hasWorkspaceData =
    !ws ||
    (agentsQuery.isSuccess &&
      messagesQuery.isSuccess &&
      tasksQuery.isSuccess &&
      workflowsQuery.isSuccess &&
      tokensQuery.isSuccess);
  const ready = workspacesQuery.isSuccess && hasValidWorkspaceSelection && hasWorkspaceData;

  const setWorkspaceId = useCallback((id: string | null) => {
    if (id === wsRef.current) return;
    wsRef.current = id;
    setWsId(id);
  }, []);

  const selectWorkspace = useCallback((id: string) => setWorkspaceId(id), [setWorkspaceId]);

  const reload = useCallback(async () => {
    const invalidations = [queryClient.invalidateQueries({ queryKey: qk.workspaces })];
    if (wsRef.current) invalidations.push(queryClient.invalidateQueries({ queryKey: ['ws', wsRef.current] }));
    await Promise.all(invalidations);
  }, [queryClient]);

  const reloadMeta = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: qk.meta });
  }, [queryClient]);

  useEffect(() => {
    if (!workspacesQuery.isSuccess || (wsId && workspaces.some((workspace) => workspace.id === wsId))) return;
    setWorkspaceId(workspaces[0]?.id ?? null);
  }, [workspacesQuery.isSuccess, workspaces, wsId, setWorkspaceId]);

  useEffect(() => {
    try {
      if (wsId) localStorage.setItem(WS_KEY, wsId);
    } catch {
      /* storage unavailable */
    }
  }, [wsId]);

  useQueryErrorToast(metaQuery.error);
  useQueryErrorToast(workspacesQuery.error);
  useQueryErrorToast(agentsQuery.error);
  useQueryErrorToast(messagesQuery.error);
  useQueryErrorToast(tasksQuery.error);
  useQueryErrorToast(workflowsQuery.error);
  useQueryErrorToast(tokensQuery.error);

  // Server pushes "something changed"; coalesce bursts into one reload.
  useEffect(() => {
    let pending: number | undefined;
    let hasConnected = false;
    const pendingWorkspaceIds = new Set<string>();
    const es = new EventSource('/api/events');
    es.onopen = () => {
      if (!hasConnected) {
        hasConnected = true;
        return;
      }
      void reload();
    };
    es.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as { type: string; id?: string; workspaceId?: string };
      // Output is streamed several times a second and changes nothing the hub data holds.
      if (event.type === 'terminal') {
        for (const listener of terminalListeners.current) listener(event.id ?? '');
        return;
      }
      const eventWorkspaceId = event.workspaceId ?? wsRef.current;
      if (eventWorkspaceId) pendingWorkspaceIds.add(eventWorkspaceId);
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: qk.workspaces });
        for (const eventWsId of pendingWorkspaceIds) {
          void queryClient.invalidateQueries({ queryKey: ['ws', eventWsId] });
        }
        pendingWorkspaceIds.clear();
      }, 120);
    };
    return () => {
      clearTimeout(pending);
      es.close();
    };
  }, [queryClient, reload]);

  const onTerminalOutput = useCallback((listener: TerminalListener) => {
    terminalListeners.current.add(listener);
    return () => void terminalListeners.current.delete(listener);
  }, []);

  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string) => {
      try {
        const out = await fn();
        if (ok) toast.success(ok);
        await reload();
        return out;
      } catch (e) {
        toast.error((e as Error).message);
        return undefined;
      }
    },
    [reload],
  );

  // attempt() reloads before it resolves, so the real message is already listed when the placeholder goes.
  const sendMessage = useCallback(
    async (input: SendInput) => {
      const wsIdNow = wsRef.current;
      if (!wsIdNow) return false;
      const item: OutgoingMessage = {
        key: crypto.randomUUID(),
        toId: input.to,
        body: input.body,
        taskId: input.taskId ?? null,
        createdAt: new Date().toISOString(),
      };
      setOutgoing((current) => [...current, item]);
      const sent = await attempt(() => api.send(wsIdNow, input));
      setOutgoing((current) => current.filter((o) => o.key !== item.key));
      return sent !== undefined;
    },
    [attempt],
  );

  const value = useMemo<Hub>(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    return {
      ready,
      meta: metaQuery.data ?? null,
      workspaces,
      ws,
      agents,
      messages,
      tasks,
      workflows,
      tokens,
      selectWorkspace,
      reload,
      reloadMeta,
      attempt,
      outgoing,
      sendMessage,
      agentById: (id) => (id ? byId.get(id) : undefined),
      onTerminalOutput,
    };
  }, [
    ready,
    metaQuery.data,
    workspaces,
    ws,
    agents,
    messages,
    tasks,
    workflows,
    tokens,
    selectWorkspace,
    reload,
    reloadMeta,
    attempt,
    outgoing,
    sendMessage,
    onTerminalOutput,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHub(): Hub {
  const h = useContext(Ctx);
  if (!h) throw new Error('useHub outside HubProvider');
  return h;
}

export type AgentState = AgentStatus;

/** Held wins over idle when the agent's mail is waiting on a hold. */
export function agentState(agent: Agent, messages: Message[]): AgentState {
  if (agent.status === AGENT_STATUS.working) return AGENT_STATUS.working;
  if (agent.paused) return AGENT_STATUS.paused;
  if (messages.some((m) => m.toId === agent.id && m.status === MESSAGE_STATUS.held)) return AGENT_STATUS.held;
  return AGENT_STATUS.idle;
}

/** Tasks and questions waiting on the human. */
export function waitingOnUser(tasks: Task[], messages: Message[]) {
  const t = tasks.filter((x) => x.status === TASK_STATUS.review || x.status === TASK_STATUS.blocked);
  const taskIds = new Set(t.map((x) => x.id));
  const loose = messages.filter(
    (m) => m.act === ACT.needsHuman && m.status === MESSAGE_STATUS.held && (!m.taskId || !taskIds.has(m.taskId)),
  );
  return { tasks: t, messages: loose, count: t.length + loose.length };
}

/** Why a task waits on the human, in the viewer's language (the server leaves step-generic reasons empty). */
export function waitingText(task: Task, workflows: Workflow[]): string {
  if (task.waitingReason) return task.waitingReason;
  const step = workflows.find((w) => w.id === task.workflowId)?.steps.find((s) => s.id === task.stepId);
  if (!step) return '';
  return step.agentId ? t('tasks.approveStep', { name: step.name }) : t('tasks.yourStep', { name: step.name });
}

/** Top-level screens; the first segment of the hash route. */
export const PAGE = {
  home: 'home',
  inbox: 'inbox',
  tasks: 'tasks',
  workflows: 'workflows',
  agents: 'agents',
  settings: 'settings',
} as const;

export function useHashRoute(): [string[], (path: string) => void] {
  const read = () => (location.hash.replace(/^#\/?/, '') || PAGE.home).split('/');
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [parts, (p) => (location.hash = '/' + p)];
}
