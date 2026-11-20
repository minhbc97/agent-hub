import { execFileSync } from 'node:child_process';

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
