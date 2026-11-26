import assert from 'node:assert/strict';
import { ACT, MESSAGE_STATUS, TASK_STATUS, USER_ID, type Message, type Task } from '../src/shared/contracts.ts';
import { NOTIFICATION_KIND, diffNotifications, type NotificationSnapshot } from '../src/web/lib/notifications.ts';

const workspaceId = 'workspace-1';
const agentId = 'agent-1';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'message-1',
    workspaceId,
    fromId: agentId,
    toId: 'agent-2',
    act: ACT.request,
    subject: 'Refresh the catalog',
    body: 'PRIVATE MESSAGE BODY',
    status: MESSAGE_STATUS.queued,
    holdReason: null,
    urgent: false,
    decision: null,
    parentId: null,
    runId: null,
    taskId: null,
    options: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    workspaceId,
    key: 'T-1',
    title: 'Refresh the catalog',
    body: 'PRIVATE TASK BODY',
    workflowId: null,
    stepId: null,
    status: TASK_STATUS.doing,
    assigneeId: agentId,
    createdBy: USER_ID,
    result: 'PRIVATE TASK OUTPUT',
    waitingReason: 'PRIVATE WAITING REASON',
    baseCommit: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function snapshot(messages: Message[] = [], tasks: Task[] = [], id = workspaceId): NotificationSnapshot {
  return { workspaceId: id, messages, tasks, agents: [{ id: agentId, name: 'Catalog Agent' }] };
}

function kinds(previous: NotificationSnapshot, next: NotificationSnapshot) {
  return diffNotifications(previous, next, USER_ID).map(({ kind }) => kind);
}

const empty = snapshot();
assert.deepEqual(diffNotifications(null, snapshot([message({ act: ACT.reply, toId: USER_ID })]), USER_ID), []);
assert.deepEqual(
  diffNotifications(snapshot([], [], 'workspace-old'), snapshot([message({ act: ACT.reply, toId: USER_ID })]), USER_ID),
  [],
);

assert.deepEqual(
  kinds(empty, snapshot([message({ act: ACT.needsHuman, toId: USER_ID, status: MESSAGE_STATUS.held })])),
  [NOTIFICATION_KIND.needsHuman],
);
const pendingQuestion = message({ act: ACT.needsHuman, toId: USER_ID, status: MESSAGE_STATUS.queued });
assert.deepEqual(
  kinds(snapshot([pendingQuestion]), snapshot([message({ ...pendingQuestion, status: MESSAGE_STATUS.held })])),
  [NOTIFICATION_KIND.needsHuman],
);
assert.deepEqual(kinds(empty, snapshot([], [task({ status: TASK_STATUS.review })])), [NOTIFICATION_KIND.taskReview]);
assert.deepEqual(kinds(empty, snapshot([], [task({ status: TASK_STATUS.blocked })])), [NOTIFICATION_KIND.taskBlocked]);
assert.deepEqual(kinds(empty, snapshot([], [task({ status: TASK_STATUS.done })])), [NOTIFICATION_KIND.taskDone]);
assert.deepEqual(
  kinds(empty, snapshot([message({ act: ACT.reply, toId: USER_ID, status: MESSAGE_STATUS.delivered })])),
  [NOTIFICATION_KIND.agentReply],
);
assert.deepEqual(kinds(empty, snapshot([message({ status: MESSAGE_STATUS.failed })])), [
  NOTIFICATION_KIND.messageFailed,
]);
assert.deepEqual(
  kinds(empty, snapshot([message({ status: MESSAGE_STATUS.held, holdReason: 'claude quota reached' })])),
  [NOTIFICATION_KIND.quotaHold],
);

const userMessage = message({ fromId: USER_ID, toId: agentId, status: MESSAGE_STATUS.failed });
assert.deepEqual(kinds(empty, snapshot([userMessage])), []);
const userQuestion = message({
  fromId: USER_ID,
  toId: agentId,
  act: ACT.needsHuman,
  status: MESSAGE_STATUS.held,
});
assert.deepEqual(kinds(empty, snapshot([userQuestion])), []);

const reply = message({ act: ACT.reply, toId: USER_ID, status: MESSAGE_STATUS.delivered });
const next = snapshot([reply]);
const firstDiff = diffNotifications(empty, next, USER_ID);
assert.equal(firstDiff.length, 1);
assert.deepEqual(diffNotifications(next, next, USER_ID), []);
assert.equal(JSON.stringify(firstDiff).includes('PRIVATE'), false);

console.log('Notification diff tests passed');
