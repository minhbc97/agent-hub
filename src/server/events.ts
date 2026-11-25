import { EventEmitter } from 'node:events';

export interface HubEvent {
  /** `terminal`: agent `id` printed something; nothing stored changed. */
  type: 'message' | 'agent' | 'run' | 'task' | 'workflow' | 'terminal';
  workspaceId: string;
  id?: string;
}

/** In-process change feed; the HTTP layer forwards it to the UI over SSE. */
export const hubEvents = new EventEmitter();
hubEvents.setMaxListeners(100);

export function emit(e: HubEvent) {
  hubEvents.emit('change', e);
}
