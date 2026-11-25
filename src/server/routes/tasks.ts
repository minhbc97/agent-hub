import { HttpError } from '../http/errors.ts';
import { body, str } from '../http/request.ts';
import { needWorkspace, needTask, resolveAssignee } from '../api/validation.ts';
import { TASK_STATUS, TASK_STATUSES } from '../../shared/contracts.ts';
import { createTask, deleteTask, getWorkflow, listTasks, updateTask, type TaskStatus } from '../db.ts';
import { answer, decide, startTask } from '../workflow.ts';
import { taskChanges } from '../task-branch.ts';
import { tick } from '../bus.ts';
import { emit } from '../events.ts';
import { on } from '../http/router.ts';

on('GET', '/api/workspaces/:ws/tasks', (_q, _r, p) => listTasks(needWorkspace(p.ws!).id));

on('POST', '/api/workspaces/:ws/tasks', async (req, _r, p) => {
  const ws = needWorkspace(p.ws!);
  const b = await body(req);
  const title = str(b.title).trim();
  if (!title) throw new HttpError(400, 'errors.taskTitleRequired');
  const workflowId = str(b.workflowId) || null;
  if (workflowId && getWorkflow(workflowId)?.workspaceId !== ws.id) throw new HttpError(400, 'errors.workflowNotFound');
  const assigneeId = workflowId ? null : resolveAssignee(ws.id, b.assigneeId);
  const task = createTask({
    workspaceId: ws.id,
    title: title.slice(0, 200),
    body: str(b.body),
    workflowId,
    assigneeId,
  });
  const out = b.start === false ? task : startTask(task);
  emit({ type: 'task', workspaceId: ws.id, id: task.id });
  tick();
  return out;
});

on('PATCH', '/api/tasks/:id', async (req, _r, p) => {
  const task = needTask(p.id!);
  const b = await body(req);
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) {
    if (!str(b.title).trim()) throw new HttpError(400, 'errors.taskTitleRequired');
    patch.title = str(b.title).trim().slice(0, 200);
  }
  if (b.body !== undefined) patch.body = str(b.body);
  if (b.status !== undefined) {
    if (!TASK_STATUSES.includes(b.status as TaskStatus)) throw new HttpError(400, 'errors.taskStatusInvalid');
    patch.status = b.status;
  }
  if (b.assigneeId !== undefined) patch.assigneeId = resolveAssignee(task.workspaceId, b.assigneeId);
  const out = updateTask(task.id, patch);
  emit({ type: 'task', workspaceId: task.workspaceId, id: task.id });
  return out;
});

on('DELETE', '/api/tasks/:id', (_q, _r, p) => {
  const task = needTask(p.id!);
  deleteTask(task.id);
  emit({ type: 'task', workspaceId: task.workspaceId });
  return { ok: true };
});

on('GET', '/api/tasks/:id/changes', (_q, _r, p) => {
  const task = needTask(p.id!);
  return taskChanges(needWorkspace(task.workspaceId).repoPath, task);
});

on('POST', '/api/tasks/:id/start', async (req, _r, p) => {
  const task = needTask(p.id!);
  if (task.status !== TASK_STATUS.todo) throw new HttpError(400, 'errors.taskMustBeTodo');
  const b = await body(req);
  const out = startTask(task, str(b.note));
  if (out.status === TASK_STATUS.todo) throw new HttpError(400, 'errors.taskNeedsAssignee');
  tick();
  return out;
});

on('POST', '/api/tasks/:id/decision', async (req, _r, p) => {
  const b = await body(req);
  const task = needTask(p.id!);
  const out = decide(task.id, !!b.approve, str(b.note));
  tick();
  return out;
});

on('POST', '/api/tasks/:id/answer', async (req, _r, p) => {
  const b = await body(req);
  const task = needTask(p.id!);
  if (!str(b.body).trim()) throw new HttpError(400, 'errors.answerRequired');
  const out = answer(task.id, str(b.body));
  tick();
  return out;
});
