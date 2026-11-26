import { useEffect, useRef } from 'react';
import { USER_ID } from './api';
import { useHub } from './hub';
import { t } from './i18n';
import {
  diffNotifications,
  MAX_NOTIFICATION_TEXT_LENGTH,
  NOTIFICATION_KIND,
  type NotificationKind,
  type NotificationSnapshot,
  type SystemNotification,
} from './notifications';
import { useNotificationSettings } from './notification-settings';

const NOTIFICATION_BATCH_MS = 2_000;
const MAX_NOTIFICATION_DETAILS = 3;
const NOTIFICATION_ICON = '/agent-hub-mark.svg';

function isOutOfView(): boolean {
  return document.hidden || !document.hasFocus();
}

function isEnabled(kind: NotificationKind, enabled: boolean, kinds: Record<NotificationKind, boolean>): boolean {
  return enabled && kinds[kind];
}

function truncate(value: string): string {
  return value.slice(0, MAX_NOTIFICATION_TEXT_LENGTH);
}

function notificationBody(kind: NotificationKind, itemTitle: string, agent: string): string {
  if (kind === NOTIFICATION_KIND.needsHuman && !itemTitle && /^\d+$/.test(agent)) {
    return t('notifications.waitingCount', { count: Number(agent) });
  }
  const keys: Record<NotificationKind, string> = {
    [NOTIFICATION_KIND.needsHuman]: 'needsHuman',
    [NOTIFICATION_KIND.taskReview]: 'taskReview',
    [NOTIFICATION_KIND.taskBlocked]: 'taskBlocked',
    [NOTIFICATION_KIND.taskDone]: 'taskDone',
    [NOTIFICATION_KIND.agentReply]: 'agentReply',
    [NOTIFICATION_KIND.messageFailed]: 'messageFailed',
    [NOTIFICATION_KIND.quotaHold]: 'quotaHold',
  };
  return t(`notifications.items.${keys[kind]}`, {
    agent: agent || t('notifications.unknownAgent'),
    item: itemTitle || t('notifications.untitled'),
  });
}

/** shortcut: system notifications work only while this hub page is open; background delivery needs a service worker or push. */
export function useSystemNotifications(onNavigate: (route: string) => void) {
  const hub = useHub();
  const settings = useNotificationSettings();
  const snapshotRef = useRef<NotificationSnapshot | null>(null);
  const pendingRef = useRef<SystemNotification[]>([]);
  const unreadCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalTitleRef = useRef('');
  const navigateRef = useRef(onNavigate);
  const settingsRef = useRef(settings);
  const workspaceRef = useRef(hub.ws);
  navigateRef.current = onNavigate;
  settingsRef.current = settings;
  workspaceRef.current = hub.ws;

  useEffect(() => {
    if (!originalTitleRef.current) originalTitleRef.current = document.title;
    if (!hub.ready || !hub.ws) {
      snapshotRef.current = null;
      return;
    }

    const next: NotificationSnapshot = {
      workspaceId: hub.ws.id,
      messages: hub.messages,
      tasks: hub.tasks,
      agents: hub.agents.map(({ id, name }) => ({ id, name })),
    };
    const previous = snapshotRef.current;
    snapshotRef.current = next;
    if (!previous || previous.workspaceId !== next.workspaceId) return;

    const notices = diffNotifications(previous, next, USER_ID).filter(({ kind }) =>
      isEnabled(kind, settings.enabled, settings.kinds),
    );
    if (!notices.length || !isOutOfView()) return;

    unreadCountRef.current += notices.length;
    document.title = t('notifications.tabTitle', { count: unreadCountRef.current, workspace: hub.ws.name });
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    pendingRef.current.push(...notices);
    if (timerRef.current) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const workspace = workspaceRef.current;
      const pending = pendingRef.current
        .splice(0)
        .filter(({ kind }) => isEnabled(kind, settingsRef.current.enabled, settingsRef.current.kinds));
      if (!workspace || !pending.length || !isOutOfView() || Notification.permission !== 'granted') return;

      const details = pending
        .slice(0, MAX_NOTIFICATION_DETAILS)
        .map(({ kind, title, body }) => truncate(notificationBody(kind, title, body)));
      if (pending.length > MAX_NOTIFICATION_DETAILS)
        details.push(t('notifications.moreItems', { count: pending.length - MAX_NOTIFICATION_DETAILS }));
      const title =
        pending.length === 1
          ? t('notifications.systemTitle', { workspace: workspace.name })
          : t('notifications.batchTitle', { count: pending.length, workspace: workspace.name });
      const notification = new Notification(title, {
        body: details.join('\n'),
        icon: NOTIFICATION_ICON,
        tag: `agent-hub-${workspace.id}`,
      });
      notification.onclick = () => {
        window.focus();
        navigateRef.current(pending[0]!.route);
        notification.close();
      };
    }, NOTIFICATION_BATCH_MS);
  }, [hub.ready, hub.ws, hub.messages, hub.tasks, hub.agents, settings]);

  useEffect(() => {
    const clearUnread = () => {
      if (isOutOfView()) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = [];
      unreadCountRef.current = 0;
      if (originalTitleRef.current) document.title = originalTitleRef.current;
    };
    document.addEventListener('visibilitychange', clearUnread);
    window.addEventListener('focus', clearUnread);
    window.addEventListener('blur', clearUnread);
    return () => {
      document.removeEventListener('visibilitychange', clearUnread);
      window.removeEventListener('focus', clearUnread);
      window.removeEventListener('blur', clearUnread);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (originalTitleRef.current) document.title = originalTitleRef.current;
    };
  }, []);
}
