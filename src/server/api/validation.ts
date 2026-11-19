import { existsSync, statSync } from 'node:fs';
import {
  getAgent,
  getTask,
  getWorkflow,
  getWorkspace,
  listAgents,
  newId,
  type Agent,
  type Workflow,
  type WorkflowStep,
  type WorkspaceSettings,
} from '../db.ts';
import { nextRuns } from '../cron.ts';
import { isEngineSupported } from '../engines/index.ts';
import {
  ENGINE,
  ENGINES,
  ISOLATION,
  ISOLATIONS,
  RESET_POLICIES,
  ROUTING,
  TRIGGER_KIND,
  USER_ID,
  type Engine,
} from '../../shared/contracts.ts';
import { HttpError } from '../http/errors.ts';
import { str } from '../http/request.ts';

export const SUPPORTED_ENGINES: readonly Engine[] = ENGINES.filter(isEngineSupported);

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function needWorkspace(id: string) {
  const ws = getWorkspace(id);
  if (!ws) throw new HttpError(404, 'errors.workspaceNotFound');
  return ws;
}

export function needTask(id: string) {
  const t = getTask(id);
  if (!t) throw new HttpError(404, 'errors.taskNotFound');
  return t;
}

export function needWorkflow(id: string) {
  const w = getWorkflow(id);
  if (!w) throw new HttpError(404, 'errors.workflowNotFound');
  return w;
}

export function resolveAssignee(workspaceId: string, v: unknown): string | null {
  const id = str(v);
  if (!id) return null;
  if (id === USER_ID) return USER_ID;
  const a = listAgents(workspaceId).find((x) => x.id === id || x.name === id.toLowerCase());
  if (!a) throw new HttpError(400, 'errors.assigneeNotFound');
  return a.id;
}

type WorkflowFields = Omit<Workflow, 'id' | 'createdAt' | 'lastRunKey' | 'workspaceId'>;

export function workflowFields(b: Record<string, unknown>, workspaceId: string): WorkflowFields {
  const name = str(b.name).trim();
  if (!name) throw new HttpError(400, 'errors.workflowNameRequired');
  const agents = new Set(listAgents(workspaceId).map((a) => a.id));
  if (!Array.isArray(b.steps)) throw new HttpError(400, 'errors.workflowStepsArray');
  if (b.steps.length > 30) throw new HttpError(400, 'errors.workflowStepLimit');
  const steps: WorkflowStep[] = b.steps.map((raw: unknown, i: number) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const stepName = str(s.name).trim();
    if (!stepName) throw new HttpError(400, 'errors.workflowStepNameRequired', { number: i + 1 });
    const agentId = str(s.agentId) || null;
    if (agentId && !agents.has(agentId))
      throw new HttpError(400, 'errors.workflowStepAgentMissing', {
        stepName: stepName,
      });
    return {
      id: str(s.id) || newId(),
      name: stepName.slice(0, 80),
      agentId,
      instruction: str(s.instruction).slice(0, 10_000),
      approval: !!s.approval,
      onReject: str(s.onReject) || null,
    };
  });
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) if (s.onReject && !ids.has(s.onReject)) s.onReject = null;
  const t = (b.trigger ?? {}) as Record<string, unknown>;
  const kind = t.kind === TRIGGER_KIND.schedule ? TRIGGER_KIND.schedule : TRIGGER_KIND.manual;
  const cron = str(t.cron).trim();
  if (kind === TRIGGER_KIND.schedule) {
    try {
      nextRuns(cron, 1);
    } catch {
      throw new HttpError(400, 'errors.invalidCron');
    }
  }
  return {
    name: name.slice(0, 80),
    description: str(b.description).slice(0, 2000),
    steps,
    trigger: {
      kind,
      cron,
      title: str(t.title).slice(0, 200),
      body: str(t.body).slice(0, 10_000),
    },
    enabled: b.enabled === undefined ? true : !!b.enabled,
  };
}

export function needAgent(id: string) {
  const a = getAgent(id);
  if (!a) throw new HttpError(404, 'errors.agentNotFound');
  return a;
}

export function workspaceFields(b: Record<string, unknown>, creating: boolean) {
  const out: { name?: string; repoPath?: string; worktreesDir?: string } = {};
  if (b.name !== undefined || creating) {
    const name = str(b.name).trim();
    if (!name) throw new HttpError(400, 'errors.workspaceNameRequired');
    out.name = name.slice(0, 60);
  }
  if (b.repoPath !== undefined) {
    const p = str(b.repoPath).trim();
    if (p && !(existsSync(p) && statSync(p).isDirectory()))
      throw new HttpError(400, 'errors.repositoryNotFound', { path: p });
    out.repoPath = p;
  }
  if (b.worktreesDir !== undefined) out.worktreesDir = str(b.worktreesDir).trim();
  return out;
}

export function settingsFields(v: unknown, workspaceId: string): Partial<WorkspaceSettings> {
  if (!v || typeof v !== 'object') throw new HttpError(400, 'errors.settingsInvalid');
  const s = v as Record<string, unknown>;
  const out: Partial<WorkspaceSettings> = {};
  if (s.routing !== undefined) {
    if (s.routing !== ROUTING.star && s.routing !== ROUTING.mesh) throw new HttpError(400, 'errors.routingInvalid');
    out.routing = s.routing;
  }
  if (s.directPairs !== undefined) {
    const names = new Set(listAgents(workspaceId).map((a) => a.name));
    if (!Array.isArray(s.directPairs)) throw new HttpError(400, 'errors.directPairsArray');
    const seen = new Set<string>();
    out.directPairs = [];
    for (const pair of s.directPairs) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new HttpError(400, 'errors.directPairSize');
      const [x, y] = pair.map((n) => str(n).toLowerCase()) as [string, string];
      if (!names.has(x) || !names.has(y) || x === y)
        throw new HttpError(400, 'errors.directPairInvalid', { pair: `${x} ↔ ${y}` });
      const key = [x, y].sort().join('|');
      if (!seen.has(key)) out.directPairs.push([x, y]);
      seen.add(key);
    }
  }
  const num = (k: 'maxConcurrent' | 'maxTurnsPerHour' | 'turnTimeoutMin' | 'maxHops', min: number, max: number) => {
    if (s[k] === undefined) return;
    const n = Number(s[k]);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new HttpError(400, 'errors.settingOutOfRange', {
        setting: k,
        min: min,
        max: max,
      });
    out[k] = n;
  };
  num('maxConcurrent', 1, 20);
  num('maxTurnsPerHour', 1, 1000);
  num('turnTimeoutMin', 1, 240);
  num('maxHops', 1, 100);
  return out;
}

export function agentFields(b: Record<string, unknown>, workspaceId: string, cur: Agent | null): Partial<Agent> {
  const out: Partial<Agent> = {};
  if (b.name !== undefined) {
    const name = str(b.name).trim().toLowerCase();
    if (!NAME_RE.test(name)) throw new HttpError(400, 'errors.agentNameFormat');
    if (name === USER_ID) throw new HttpError(400, 'errors.reservedAgentName');
    const clash = listAgents(workspaceId).find((a) => a.name === name && a.id !== cur?.id);
    if (clash) throw new HttpError(400, 'errors.agentNameExists', { name: name });
    out.name = name;
  }
  const text = (k: 'role' | 'model' | 'command' | 'extraArgs' | 'cwd' | 'avatarSeed', max: number) => {
    if (b[k] !== undefined) out[k] = str(b[k]).slice(0, max);
  };
  text('role', 20_000);
  text('model', 100);
  text('command', 500);
  text('extraArgs', 1000);
  text('cwd', 500);
  text('avatarSeed', 100);
  if (b.briefFiles !== undefined) {
    const list = Array.isArray(b.briefFiles) ? b.briefFiles : str(b.briefFiles).split(/\r?\n/);
    out.briefFiles = list
      .map((f) => str(f).trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  const oneOf = <T extends string>(k: keyof Agent, allowed: readonly T[]) => {
    if (b[k] === undefined) return;
    if (!allowed.includes(b[k] as T)) throw new HttpError(400, 'errors.fieldInvalid', { field: k });
    (out as Record<string, unknown>)[k] = b[k];
  };
  oneOf('engine', ENGINES);
  oneOf('isolation', ISOLATIONS);
  oneOf('resetPolicy', RESET_POLICIES);
  if (b.tint !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(str(b.tint))) throw new HttpError(400, 'errors.tintInvalid');
    out.tint = str(b.tint);
  }
  const int = (k: 'dailyTokenBudget' | 'resetValue') => {
    if (b[k] === undefined) return;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'errors.integerNonnegative', { field: k });
    out[k] = n;
  };
  int('dailyTokenBudget');
  int('resetValue');
  if (b.isOrchestrator !== undefined) out.isOrchestrator = !!b.isOrchestrator;
  if (b.paused !== undefined) out.paused = !!b.paused;

  const engine = out.engine ?? cur?.engine ?? ENGINE.claude;
  const isolation = out.isolation ?? cur?.isolation ?? ISOLATION.shared;
  if (engine === ENGINE.custom && !(out.command ?? cur?.command)?.trim())
    throw new HttpError(400, 'errors.customEngineCommandRequired');
  if (isolation === ISOLATION.custom && !(out.cwd ?? cur?.cwd)?.trim())
    throw new HttpError(400, 'errors.customIsolationDirectoryRequired');
  return out;
}
