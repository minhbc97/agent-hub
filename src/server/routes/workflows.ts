import { HttpError } from '../http/errors.ts';
import { body, str } from '../http/request.ts';
import { needWorkspace, needWorkflow, workflowFields } from '../api/validation.ts';
import { deleteWorkflow, listWorkflows, saveWorkflow } from '../db.ts';
import { runWorkflow } from '../workflow.ts';
import { nextRuns } from '../cron.ts';
import { tick } from '../bus.ts';
import { emit } from '../events.ts';
import { on } from '../http/router.ts';

on('GET', '/api/workspaces/:ws/workflows', (_q, _r, p) => listWorkflows(needWorkspace(p.ws!).id));

on('POST', '/api/workspaces/:ws/workflows', async (req, _r, p) => {
  const ws = needWorkspace(p.ws!);
  const wf = saveWorkflow({
    ...workflowFields(await body(req), ws.id),
    workspaceId: ws.id,
  });
  emit({ type: 'workflow', workspaceId: ws.id, id: wf.id });
  return wf;
});

on('PATCH', '/api/workflows/:id', async (req, _r, p) => {
  const cur = needWorkflow(p.id!);
  const b = await body(req);
  const merged = {
    name: cur.name,
    description: cur.description,
    steps: cur.steps,
    trigger: cur.trigger,
    enabled: cur.enabled,
    ...b,
  };
  const wf = saveWorkflow({
    ...workflowFields(merged, cur.workspaceId),
    workspaceId: cur.workspaceId,
    id: cur.id,
  });
  emit({ type: 'workflow', workspaceId: cur.workspaceId, id: wf.id });
  return wf;
});

on('DELETE', '/api/workflows/:id', (_q, _r, p) => {
  const wf = needWorkflow(p.id!);
  deleteWorkflow(wf.id);
  emit({ type: 'workflow', workspaceId: wf.workspaceId });
  return { ok: true };
});

on('POST', '/api/workflows/:id/run', async (req, _r, p) => {
  const wf = needWorkflow(p.id!);
  if (!wf.steps.length) throw new HttpError(400, 'errors.workflowHasNoSteps');
  const b = await body(req);
  const title = str(b.title).trim() || `${wf.name} ${new Date().toISOString().slice(0, 10)}`;
  const task = runWorkflow(wf, title.slice(0, 200), str(b.body));
  tick();
  return task;
});

on('POST', '/api/cron/preview', async (req) => {
  const b = await body(req);
  try {
    return { next: nextRuns(str(b.cron), 3).map((d) => d.toISOString()) };
  } catch {
    throw new HttpError(400, 'errors.invalidCron');
  }
});
