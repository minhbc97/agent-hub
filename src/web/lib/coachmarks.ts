import { useEffect, useSyncExternalStore } from 'react';

const SEEN_KEY = 'agent-hub.guides-seen';

/** Ids of coachmarks, tips and the getting-started list the user closed; remembered on this device. */
let seen = readSeen();
/** Coachmarks on screen, in mount order: only the first one not yet seen opens, so they never stack. */
let mounted: string[] = [];
let version = 0;
const listeners = new Set<() => void>();

function readSeen(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markSeen(id: string) {
  if (seen.has(id)) return;
  seen = new Set(seen).add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage full or blocked: the guide shows again next visit, which is harmless.
  }
  changed();
}

/** Shows every coachmark, tip and the getting-started list again. */
export function resetSeen() {
  seen = new Set();
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    // See markSeen.
  }
  changed();
}

/** Re-renders when anything is seen or reset; returns the check for whether an id was seen. */
export function useSeen(): (id: string) => boolean {
  useSyncExternalStore(subscribe, () => version);
  return (id) => seen.has(id);
}

/** Whether coachmark `id` is the one to show now. */
export function useCoachmark(id: string): boolean {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    mounted = [...mounted, id];
    changed();
    return () => {
      mounted = mounted.filter((x) => x !== id);
      changed();
    };
  }, [id]);
  return mounted.find((x) => !seen.has(x)) === id;
}
