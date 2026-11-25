import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Workspace } from '../shared/contracts.ts';

const GIT_CHECK_TIMEOUT_MS = 5000;

/** Worktree isolation needs a git repo with at least one commit: `git worktree add --detach` checks out HEAD. */
export function hasGitHead(repoPath: string): boolean {
  if (!repoPath) return false;
  try {
    execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', '--quiet', 'HEAD'], {
      stdio: 'ignore',
      timeout: GIT_CHECK_TIMEOUT_MS,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Folder holding the workspace's agent worktrees. */
export const worktreesBase = (ws: Pick<Workspace, 'name' | 'repoPath' | 'worktreesDir'>) =>
  resolve(ws.worktreesDir || join(ws.repoPath, '..', `${ws.name}-worktrees`));

/** The repository a folder belongs to (the same for all its worktrees), or null outside git. */
function repositoryOf(dir: string): string | null {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: GIT_CHECK_TIMEOUT_MS,
      windowsHide: true,
    });
    return realpathSync.native(resolve(dir, out.trim()));
  } catch {
    return null;
  }
}

export function isWorktreeOf(dir: string, repoPath: string): boolean {
  const repository = repositoryOf(dir);
  return repository !== null && repository === repositoryOf(repoPath);
}
