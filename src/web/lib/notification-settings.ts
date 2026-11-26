import { useSyncExternalStore } from 'react';
import { NOTIFICATION_KIND, NOTIFICATION_KINDS, type NotificationKind } from './notifications';

const STORAGE_KEY = 'agent-hub.notifications';

export const NOTIFICATION_DEFAULTS: Record<NotificationKind, boolean> = {
  [NOTIFICATION_KIND.needsHuman]: true,
  [NOTIFICATION_KIND.taskReview]: true,
  [NOTIFICATION_KIND.taskBlocked]: true,
  [NOTIFICATION_KIND.taskDone]: true,
  [NOTIFICATION_KIND.agentReply]: true,
  [NOTIFICATION_KIND.messageFailed]: true,
  [NOTIFICATION_KIND.quotaHold]: false,
};

export interface NotificationSettings {
  enabled: boolean;
  kinds: Record<NotificationKind, boolean>;
}

const DEFAULT_SETTINGS: NotificationSettings = { enabled: true, kinds: NOTIFICATION_DEFAULTS };
const listeners = new Set<() => void>();

function readSettings(): NotificationSettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SETTINGS;
    const stored = parsed as { enabled?: unknown; kinds?: unknown };
    const kinds = { ...NOTIFICATION_DEFAULTS };
    if (stored.kinds && typeof stored.kinds === 'object') {
      for (const kind of NOTIFICATION_KINDS) {
        const value = (stored.kinds as Record<string, unknown>)[kind];
        if (typeof value === 'boolean') kinds[kind] = value;
      }
    }
    return { enabled: typeof stored.enabled === 'boolean' ? stored.enabled : true, kinds };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let settings = typeof localStorage === 'undefined' ? DEFAULT_SETTINGS : readSettings();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function saveSettings(next: NotificationSettings) {
  settings = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: keep the setting for this page session.
  }
  notifyListeners();
}

export function setNotificationsEnabled(enabled: boolean) {
  saveSettings({ ...settings, enabled });
}

export function setNotificationKindEnabled(kind: NotificationKind, enabled: boolean) {
  saveSettings({ ...settings, kinds: { ...settings.kinds, [kind]: enabled } });
}

export function useNotificationSettings(): NotificationSettings {
  return useSyncExternalStore(
    subscribe,
    () => settings,
    () => DEFAULT_SETTINGS,
  );
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    settings = readSettings();
    notifyListeners();
  });
}
