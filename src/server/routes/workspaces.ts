import { HttpError } from '../http/errors.ts';
import { body } from '../http/request.ts';
import { needWorkspace, workspaceFields, settingsFields } from '../api/validation.ts';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listAgents,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceSettings,
} from '../db.ts';
import { isAgentRunning } from '../bus.ts';
import { emit } from '../events.ts';
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
  updateWorkspace(cur.id, {
    ...fields,
    ...(settings ? { settings: settings as WorkspaceSettings } : {}),
  });
  emit({ type: 'agent', workspaceId: cur.id });
  return getWorkspace(cur.id);
});

on('DELETE', '/api/workspaces/:ws', (_q, _r, p) => {
  const ws = needWorkspace(p.ws!);
  if (listAgents(ws.id).some((a) => isAgentRunning(a.id))) throw new HttpError(409, 'errors.workspaceHasRunningAgents');
  deleteWorkspace(ws.id);
  return { ok: true };
});
