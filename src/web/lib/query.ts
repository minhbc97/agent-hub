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
  taskChanges: (wsId: string, taskId: string, updatedAt: string) =>
    ['ws', wsId, 'taskChanges', taskId, updatedAt] as const,
  terminal: (wsId: string, agentId: string) => ['ws', wsId, 'terminal', agentId] as const,
  usage: ['usage'] as const,
};
