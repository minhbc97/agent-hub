import {
  ACT,
  HUB_ID,
  MESSAGE_STATUS,
  TASK_STATUS,
  USER_ID,
  type Agent,
  type Message,
  type Task,
} from '../../shared/contracts.ts';

export const NOTIFICATION_KIND = {
  needsHuman: 'needsHuman',
  taskReview: 'taskReview',
  taskBlocked: 'taskBlocked',
  taskDone: 'taskDone',
  agentReply: 'agentReply',
  messageFailed: 'messageFailed',
  quotaHold: 'quotaHold',
} as const;

export type NotificationKind = (typeof NOTIFICATION_KIND)[keyof typeof NOTIFICATION_KIND];

export const NOTIFICATION_KINDS = Object.values(NOTIFICATION_KIND);

export const NOTIFICATION_ROUTE = {
  tasks: 'tasks',
  inboxNeeds: 'inbox:needs',
  inboxTeam: 'inbox:team',
  inboxAgentPrefix: 'inbox:agent:',
} as const;

export interface NotificationSnapshot {
  workspaceId: string;
  messages: Message[];
  tasks: Task[];
  agents?: Pick<Agent, 'id' | 'name'>[];
}

export interface SystemNotification {
  kind: NotificationKind;
  /** Safe short label, such as a task title or message subject; never the message body. */
  title: string;
  /** Agent name when available. */
  body: string;
  route: string;
}

export const MAX_NOTIFICATION_TEXT_LENGTH = 120;

const QUOTA_REASON = /quota|rate limit|turn limit/i;
const USER_MESSAGE_ACTS = new Set<Message['act']>([ACT.reply, ACT.inform, ACT.done]);

function shortText(value: string): string {
  return value.trim().slice(0, MAX_NOTIFICATION_TEXT_LENGTH);
}

function agentName(snapshot: NotificationSnapshot, agentId: string | null): string {
  if (!agentId) return '';
  return snapshot.agents?.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function taskAgentName(snapshot: NotificationSnapshot, task: Task): string {
  if (task.assigneeId && task.assigneeId !== USER_ID) return agentName(snapshot, task.assigneeId);
  const message = [...snapshot.messages]
    .reverse()
    .find((item) => item.taskId === task.id && item.fromId !== USER_ID && item.fromId !== HUB_ID);
  return agentName(snapshot, message?.fromId ?? null);
}

function changedTo(status: Task['status'], previous: Task | undefined): boolean {
  return previous?.status !== status;
}

function waitingCount(tasks: Task[], messages: Message[], userId: string): number {
  const waitingTasks = tasks.filter(
    (task) => task.status === TASK_STATUS.review || task.status === TASK_STATUS.blocked,
  );
  const waitingTaskIds = new Set(waitingTasks.map((task) => task.id));
  const looseQuestions = messages.filter(
    (message) =>
      message.act === ACT.needsHuman &&
      message.fromId !== userId &&
      message.status === MESSAGE_STATUS.held &&
      (!message.taskId || !waitingTaskIds.has(message.taskId)),
  );
  return waitingTasks.length + looseQuestions.length;
}

export function diffNotifications(
  prev: NotificationSnapshot | null,
  next: NotificationSnapshot,
  userId: string,
): SystemNotification[] {
  if (!prev || !prev.workspaceId || prev.workspaceId !== next.workspaceId) return [];

  const previousMessages = new Map(prev.messages.map((message) => [message.id, message]));
  const previousTasks = new Map(prev.tasks.map((task) => [task.id, task]));
  const nextTasks = new Map(next.tasks.map((task) => [task.id, task]));
  const notices: SystemNotification[] = [];

  for (const task of next.tasks) {
    const previous = previousTasks.get(task.id);
    let kind: NotificationKind | null = null;
    if (task.status === TASK_STATUS.review && changedTo(TASK_STATUS.review, previous))
      kind = NOTIFICATION_KIND.taskReview;
    else if (task.status === TASK_STATUS.blocked && changedTo(TASK_STATUS.blocked, previous))
      kind = NOTIFICATION_KIND.taskBlocked;
    else if (task.status === TASK_STATUS.done && changedTo(TASK_STATUS.done, previous))
      kind = NOTIFICATION_KIND.taskDone;
    if (!kind) continue;

    notices.push({
      kind,
      title: shortText(task.title),
      body: shortText(taskAgentName(next, task)),
      route: NOTIFICATION_ROUTE.tasks,
    });
  }

  for (const message of next.messages) {
    if (message.fromId === userId) continue;
    const previous = previousMessages.get(message.id);
    const linkedTask = message.taskId ? nextTasks.get(message.taskId) : undefined;

    if (message.act === ACT.needsHuman && message.toId === userId && !previous) {
      notices.push({
        kind: NOTIFICATION_KIND.needsHuman,
        title: shortText(message.subject || linkedTask?.title || ''),
        body: shortText(agentName(next, message.fromId)),
        route: NOTIFICATION_ROUTE.inboxNeeds,
      });
    }

    if (message.toId === userId && message.fromId !== HUB_ID && USER_MESSAGE_ACTS.has(message.act) && !previous) {
      notices.push({
        kind: NOTIFICATION_KIND.agentReply,
        title: shortText(message.subject || linkedTask?.title || ''),
        body: shortText(agentName(next, message.fromId)),
        route: `${NOTIFICATION_ROUTE.inboxAgentPrefix}${message.fromId}`,
      });
    }

    if (message.status === MESSAGE_STATUS.failed && previous?.status !== MESSAGE_STATUS.failed) {
      const sourceAgent = message.fromId === userId ? message.toId : message.fromId;
      notices.push({
        kind: NOTIFICATION_KIND.messageFailed,
        title: shortText(message.subject || linkedTask?.title || ''),
        body: shortText(agentName(next, sourceAgent)),
        route:
          sourceAgent === message.fromId
            ? `${NOTIFICATION_ROUTE.inboxAgentPrefix}${sourceAgent}`
            : NOTIFICATION_ROUTE.inboxTeam,
      });
    }

    const wasQuotaHeld = previous?.status === MESSAGE_STATUS.held && QUOTA_REASON.test(previous.holdReason ?? '');
    if (message.status === MESSAGE_STATUS.held && QUOTA_REASON.test(message.holdReason ?? '') && !wasQuotaHeld) {
      notices.push({
        kind: NOTIFICATION_KIND.quotaHold,
        title: shortText(message.subject || linkedTask?.title || ''),
        body: shortText(agentName(next, message.toId)),
        route: `${NOTIFICATION_ROUTE.inboxAgentPrefix}${message.toId}`,
      });
    }
  }

  const waitingIncrease =
    waitingCount(next.tasks, next.messages, userId) - waitingCount(prev.tasks, prev.messages, userId);
  if (
    waitingIncrease > 0 &&
    !notices.some(
      ({ kind }) =>
        kind === NOTIFICATION_KIND.needsHuman ||
        kind === NOTIFICATION_KIND.taskReview ||
        kind === NOTIFICATION_KIND.taskBlocked,
    )
  ) {
    notices.push({
      kind: NOTIFICATION_KIND.needsHuman,
      title: '',
      body: String(waitingIncrease),
      route: NOTIFICATION_ROUTE.inboxNeeds,
    });
  }

  return notices;
}
