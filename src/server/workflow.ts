import {
  USER_ID,
  HUB_ID,
  ACT,
  MESSAGE_STATUS,
  TASK_STATUS,
  TRIGGER_KIND,
  DECISION,
  SCHEDULER_ID,
  type Decision,
} from '../shared/contracts.ts';
import {
  allWorkflows,
  createMessage,
  createTask,
  getTask,
  getWorkflow,
  listMessages,
  setMessageStatus,
  setWorkflowRunKey,
  updateTask,
  type Task,
  type Workflow,
  type WorkflowStep,
} from './db.ts';
import { cronMatches, minuteKey } from './cron.ts';
import { emit } from './events.ts';
import { DomainError } from './domain-error.ts';

/**
 * Workflow engine. A task optionally follows a workflow: an ordered list of steps, each done by an agent or by
 * the human. Agents finish a step by sending {"act":"done","task":"T-3"}; steps marked `approval` wait for the
 * human to approve or send back. Nothing here is specific to software work.
 */

function touch(task: Task) {
  emit({ type: 'task', workspaceId: task.workspaceId, id: task.id });
}

function stepIndex(wf: Workflow, stepId: string | null): number {
  return wf.steps.findIndex((s) => s.id === stepId);
}

/** Put a freshly created task to work. */
export function startTask(task: Task, note = ''): Task {
  const wf = task.workflowId ? getWorkflow(task.workflowId) : undefined;
  if (wf && wf.steps.length) return enterStep(task, wf, wf.steps[0]!, note);
  if (task.assigneeId && task.assigneeId !== USER_ID) {
    const t = updateTask(task.id, { status: TASK_STATUS.doing })!;
    dispatch(t, task.assigneeId, briefing(t, null, null, note));
    touch(t);
    return t;
  }
  return task;
}

function enterStep(task: Task, wf: Workflow, step: WorkflowStep, note: string): Task {
  if (!step.agentId) {
    const t = updateTask(task.id, {
      stepId: step.id,
      status: TASK_STATUS.review,
      assigneeId: USER_ID,
      // Empty reason: the UI explains a human step in the viewer's language.
      waitingReason: step.instruction,
    })!;
    touch(t);
    return t;
  }
  const t = updateTask(task.id, {
    stepId: step.id,
    status: TASK_STATUS.doing,
    assigneeId: step.agentId,
    waitingReason: '',
  })!;
  dispatch(t, step.agentId, briefing(t, wf, step, note));
  touch(t);
  return t;
}

function dispatch(task: Task, agentId: string, body: string) {
  const msg = createMessage({
    workspaceId: task.workspaceId,
    fromId: HUB_ID,
    toId: agentId,
    act: ACT.request,
    subject: `${task.key} · ${task.title}`,
    body,
    taskId: task.id,
  });
  emit({ type: 'message', workspaceId: task.workspaceId, id: msg.id });
}

function briefing(task: Task, wf: Workflow | null, step: WorkflowStep | null, note: string): string {
  const lines = [`Task ${task.key}: ${task.title}`];
  if (task.body.trim()) lines.push('', task.body.trim());
  if (wf && step) {
    const i = stepIndex(wf, step.id);
    lines.push('', `Workflow "${wf.name}", step ${i + 1}/${wf.steps.length}: ${step.name}`);
    if (step.instruction.trim()) lines.push(step.instruction.trim());
    if (i > 0 && task.result.trim())
      lines.push('', `Result of the previous step (${wf.steps[i - 1]!.name}):`, task.result.trim());
  }
  if (note.trim()) lines.push('', `Note from the human: ${note.trim()}`);
  lines.push(
    '',
    `When this is finished, write to your outbox: {"to":"user","act":"done","task":"${task.key}","body":"<your result>"}`,
    `If you need a human decision first: {"to":"user","act":"needs_human","task":"${task.key}","body":"<question>"}`,
  );
  return lines.join('\n');
}

function advance(task: Task, wf: Workflow | undefined): Task {
  if (wf) {
    const next = wf.steps[stepIndex(wf, task.stepId) + 1];
    if (next) return enterStep(task, wf, next, '');
  }
  const t = updateTask(task.id, {
    status: TASK_STATUS.done,
    assigneeId: null,
    waitingReason: '',
  })!;
  touch(t);
  return t;
}

/** An agent reported the task (or its current step) finished. */
export function agentDone(task: Task, agentId: string, result: string): void {
  if (task.status === TASK_STATUS.done || task.status === TASK_STATUS.archived) return;
  if (task.assigneeId && task.assigneeId !== agentId) return; // not this agent's turn
  const t = updateTask(task.id, { result })!;
  const wf = t.workflowId ? getWorkflow(t.workflowId) : undefined;
  const step = wf?.steps.find((s) => s.id === t.stepId);
  if (step?.approval) {
    const r = updateTask(t.id, {
      status: TASK_STATUS.review,
      assigneeId: USER_ID,
      waitingReason: '',
    })!;
    touch(r);
    return;
  }
  advance(t, wf);
}

/** An agent asked the human something about the task. */
export function agentAsks(task: Task, question: string): void {
  if (task.status === TASK_STATUS.done || task.status === TASK_STATUS.archived) return;
  touch(
    updateTask(task.id, {
      status: TASK_STATUS.blocked,
      waitingReason: question.slice(0, 2000),
    })!,
  );
}

/** Human approves or sends back a task that waits for review (or completes a human step). */
export function decide(taskId: string, approve: boolean, note: string): Task {
  const task = getTask(taskId);
  if (!task) throw new DomainError('errors.taskNotFound');
  if (task.status !== TASK_STATUS.review) throw new DomainError('errors.taskNotAwaitingReview');
  const wf = task.workflowId ? getWorkflow(task.workflowId) : undefined;
  const step = wf?.steps.find((s) => s.id === task.stepId);
  log(task, approve ? DECISION.approve : DECISION.reject, note);

  if (approve) {
    const t = step && !step.agentId && note.trim() ? updateTask(task.id, { result: note.trim() })! : task;
    return advance(t, wf);
  }
  if (wf && step) {
    const back = wf.steps.find((s) => s.id === step.onReject) ?? (step.agentId ? step : undefined);
    if (back) return enterStep(task, wf, back, note || 'The human sent the result back. Redo this step.');
  }
  if (task.assigneeId && task.assigneeId !== USER_ID) {
    const t = updateTask(task.id, { status: TASK_STATUS.doing, waitingReason: '' })!;
    dispatch(t, task.assigneeId, `${task.key} was sent back by the human.\n${note}`);
    touch(t);
    return t;
  }
  const t = updateTask(task.id, { status: TASK_STATUS.todo, waitingReason: '' })!;
  touch(t);
  return t;
}

/** Human answers a blocked task's question; the asking agent continues. */
export function answer(taskId: string, body: string): Task {
  const task = getTask(taskId);
  if (!task) throw new DomainError('errors.taskNotFound');
  if (task.status !== TASK_STATUS.blocked) throw new DomainError('errors.taskNotAwaitingAnswer');
  for (const m of listMessages(task.workspaceId, 1000)) {
    if (m.taskId === task.id && m.act === ACT.needsHuman && m.status === MESSAGE_STATUS.held)
      setMessageStatus(m.id, MESSAGE_STATUS.delivered);
  }
  const agentId = task.assigneeId && task.assigneeId !== USER_ID ? task.assigneeId : null;
  const t = updateTask(task.id, {
    status: agentId ? TASK_STATUS.doing : TASK_STATUS.todo,
    waitingReason: '',
  })!;
  if (agentId) {
    const msg = createMessage({
      workspaceId: t.workspaceId,
      fromId: USER_ID,
      toId: agentId,
      act: ACT.inform,
      subject: `${t.key} · answer`,
      body,
      taskId: t.id,
    });
    emit({ type: 'message', workspaceId: t.workspaceId, id: msg.id });
  }
  touch(t);
  return t;
}

function log(task: Task, decision: Decision, note: string) {
  const msg = createMessage({
    workspaceId: task.workspaceId,
    fromId: USER_ID,
    toId: HUB_ID,
    act: ACT.inform,
    // The UI renders `decision` in the viewer's language.
    subject: task.key,
    body: note,
    status: MESSAGE_STATUS.delivered,
    decision,
    taskId: task.id,
  });
  emit({ type: 'message', workspaceId: task.workspaceId, id: msg.id });
}

/** Create a task from a workflow and start it. */
export function runWorkflow(wf: Workflow, title: string, body: string, createdBy = USER_ID): Task {
  const task = createTask({
    workspaceId: wf.workspaceId,
    title,
    body,
    workflowId: wf.id,
    createdBy,
  });
  return startTask(task);
}

/** Fire scheduled workflows once per matching minute. */
export function tickSchedules(at = new Date()): void {
  const key = minuteKey(at);
  for (const wf of allWorkflows()) {
    if (!wf.enabled || wf.trigger.kind !== TRIGGER_KIND.schedule || !wf.trigger.cron || wf.lastRunKey === key) continue;
    let match = false;
    try {
      match = cronMatches(wf.trigger.cron, at);
    } catch {
      continue;
    }
    if (!match) continue;
    setWorkflowRunKey(wf.id, key);
    const date = at.toISOString().slice(0, 10);
    const title = (wf.trigger.title || `${wf.name} {date}`).replaceAll('{date}', date);
    runWorkflow(wf, title, wf.trigger.body.replaceAll('{date}', date), SCHEDULER_ID);
  }
}
