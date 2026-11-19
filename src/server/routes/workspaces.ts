import { HttpError } from '../http/errors.ts';
import { body } from '../http/request.ts';
import { needWorkspace, workspaceFields, settingsFields } from '../api/validation.ts';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listAgents,
  listWorkspaces,
  updateAgent,
  updateWorkspace,
  type WorkspaceSettings,
} from '../db.ts';
import { isAgentRunning } from '../bus.ts';
import { emit } from '../events.ts';
import { ISOLATION } from '../../shared/contracts.ts';
import { on } from '../http/router.ts';

on('GET', '/api/workspaces', () => listWorkspaces());

on('POST', '/api/workspaces', async (req) => {
  const b = await body(req);
  const ws = createWorkspace(workspaceFields(b, true) as { name: string });
  emit({ type: 'agent', workspaceId: ws.id });
  return ws;
});

on('PATCH', '/api/workspaces/:ws', async (req, _r, p) => {
  const cur = needWorkspace(p.ws!);
  const b = await body(req);
  const fields = workspaceFields(b, false);
  const settings = b.settings !== undefined ? settingsFields(b.settings, cur.id) : undefined;
  const movesFolders =
    (fields.repoPath !== undefined && fields.repoPath !== cur.repoPath) ||
    (fields.worktreesDir !== undefined && fields.worktreesDir !== cur.worktreesDir);
  const team = listAgents(cur.id);
  // A turn in flight keeps its old folder; moving it underneath would split one task across two checkouts.
  if (movesFolders && team.some((a) => isAgentRunning(a.id))) throw new HttpError(409, 'errors.workspaceFoldersBusy');
  updateWorkspace(cur.id, {
    ...fields,
    ...(settings ? { settings: settings as WorkspaceSettings } : {}),
  });
  // CLI sessions are tied to the folder they started in (Claude cannot resume them elsewhere),
  // so agents that work inside the repo start fresh sessions in the new location.
  if (movesFolders)
    for (const a of team)
      if (a.isolation !== ISOLATION.custom) updateAgent(a.id, { sessionId: null, turnsInSession: 0 });
  emit({ type: 'agent', workspaceId: cur.id });
  return getWorkspace(cur.id);
});

on('DELETE', '/api/workspaces/:ws', (_q, _r, p) => {
  const ws = needWorkspace(p.ws!);
  if (listAgents(ws.id).some((a) => isAgentRunning(a.id))) throw new HttpError(409, 'errors.workspaceHasRunningAgents');
  deleteWorkspace(ws.id);
  return { ok: true };
});
