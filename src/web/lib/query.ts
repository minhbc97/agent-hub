import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const qk = {
  meta: ['meta'] as const,
  workspaces: ['workspaces'] as const,
  agents: (wsId: string) => ['ws', wsId, 'agents'] as const,
  messages: (wsId: string) => ['ws', wsId, 'messages'] as const,
  tasks: (wsId: string) => ['ws', wsId, 'tasks'] as const,
  workflows: (wsId: string) => ['ws', wsId, 'workflows'] as const,
  tokens: (wsId: string) => ['ws', wsId, 'tokens'] as const,
  runs: (wsId: string, agentId: string) => ['ws', wsId, 'runs', agentId] as const,
  workspaceGit: (wsId: string) => ['ws', wsId, 'workspaceGit'] as const,
  // Keep expensive task diffs (keyed by updatedAt) and event-fed terminal streams outside workspace invalidation.
  taskChanges: (taskId: string, updatedAt: string) => ['taskChanges', taskId, updatedAt] as const,
  terminal: (agentId: string) => ['terminal', agentId] as const,
  usage: ['usage'] as const,
};
