import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  /** Run an API call; on failure show its message as a toast. Returns undefined on error. */
  attempt: <T>(fn: () => Promise<T>, ok?: string) => Promise<T | undefined>;
  outgoing: OutgoingMessage[];
  /** Sends as the user with an optimistic row; resolves false when the send failed. */
  sendMessage: (input: SendInput) => Promise<boolean>;
  agentById: (id: string | null | undefined) => Agent | undefined;
}

const Ctx = createContext<Hub | null>(null);
const WS_KEY = 'agent-hub.workspace';

function readWs(): string | null {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}

export function HubProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsId, setWsId] = useState<string | null>(readWs);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [tokens, setTokens] = useState<TokenTotal[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const wsRef = useRef(wsId);
  wsRef.current = wsId;

  const clearWorkspaceData = useCallback(() => {
    setAgents([]);
    setMessages([]);
    setTasks([]);
    setWorkflows([]);
    setTokens([]);
  }, []);

  /** Drops the old workspace's data at once: until the new data arrives, nothing of it may show or be acted on. */
  const selectWorkspace = useCallback(
    (id: string) => {
      if (id === wsRef.current) return;
      setReady(false);
      clearWorkspaceData();
      wsRef.current = id;
      setWsId(id);
    },
    [clearWorkspaceData],
  );

  const reload = useCallback(async () => {
    const list = await api.workspaces();
    setWorkspaces(list);
    let id = wsRef.current;
    if (!id || !list.some((w) => w.id === id)) id = list[0]?.id ?? null;
    if (id !== wsRef.current) {
      setReady(false);
      clearWorkspaceData();
      setWsId(id);
      wsRef.current = id;
    }
    if (id) {
      const [a, m, t, w, tk] = await Promise.all([
        api.agents(id),
        api.messages(id),
        api.tasks(id),
        api.workflows(id),
        api.tokens(id),
      ]);
      if (wsRef.current !== id) return;
      setAgents(a);
      setMessages(m);
      setTasks(t);
      setWorkflows(w);
      setTokens(tk);
    }
    setReady(true);
  }, [clearWorkspaceData]);

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      if (wsId) localStorage.setItem(WS_KEY, wsId);
    } catch {
      /* storage unavailable */
    }
    reload().catch((e) => toast.error(String(e.message ?? e)));
  }, [wsId, reload]);

  // Server pushes "something changed"; coalesce bursts into one reload.
  useEffect(() => {
    let pending: number | undefined;
    const es = new EventSource('/api/events');
    es.onmessage = () => {
      clearTimeout(pending);
      pending = window.setTimeout(() => reload().catch(() => {}), 120);
    };
    return () => {
      clearTimeout(pending);
      es.close();
    };
  }, [reload]);

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
      meta,
      workspaces,
      ws: workspaces.find((w) => w.id === wsId) ?? null,
      agents,
      messages,
      tasks,
      workflows,
      tokens,
      selectWorkspace,
      reload,
      attempt,
      outgoing,
      sendMessage,
      agentById: (id) => (id ? byId.get(id) : undefined),
    };
  }, [
    ready,
    meta,
    workspaces,
    wsId,
    agents,
    messages,
    tasks,
    workflows,
    tokens,
    selectWorkspace,
    reload,
    attempt,
    outgoing,
    sendMessage,
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
