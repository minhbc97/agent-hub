import type { Agent } from '../db.ts';
import type { EngineAdapter } from './types.ts';
import { claude } from './claude.ts';
import { codex } from './codex.ts';
import { antigravity } from './antigravity.ts';
import { custom } from './custom.ts';
import { openrouter } from './openrouter.ts';

export * from './types.ts';

const adapters: Partial<Record<Agent['engine'], EngineAdapter>> = {
  claude,
  codex,
  antigravity,
  openrouter,
  custom,
};

export const isEngineSupported = (engine: Agent['engine']) => !!adapters[engine];

export function adapterFor(engine: Agent['engine']): EngineAdapter {
  const a = adapters[engine];
  if (!a) throw new Error(`Engine "${engine}" is not supported yet`);
  return a;
}
