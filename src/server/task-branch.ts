import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FileChange, TaskChanges } from '../shared/contracts.ts';
import { updateTask, type Task } from './db.ts';

/**
 * A task's code travels between agents as a git ref: before a turn the agent's own worktree is put on it, after the
 * turn the hub commits what changed and moves it. Worktrees stay per agent because CLI sessions are tied to a folder.
 *
 * The refs live outside refs/heads on purpose: checking one out detaches HEAD, so a human looking at a task's code
 * never has the branch moved under them, and `git push --all` does not publish it.
 */
const REF_ROOT = 'refs/';
const PREFIX = 'agent-hub/';
const GIT_TIMEOUT_MS = 120_000;
const MAX_GIT_OUTPUT_BYTES = 20 * 1024 * 1024;
/** Patch text sent to the UI; files past it are listed without their patch. */
const MAX_PATCH_CHARS = 200_000;
/** The hub commits for agents, whatever identity, hooks or signing the human's own commits use. */
const COMMIT_AS_HUB = [
  '-c',
  'user.name=agent-hub',
  '-c',
  'user.email=agent-hub@localhost',
  '-c',
  'commit.gpgsign=false',
];

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  return stdout;
}

/** The commit `rev` names, or null when there is none. */
async function commitOf(cwd: string, rev: string): Promise<string | null> {
  try {
    return (await git(cwd, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`)).trim();
  } catch {
    return null;
  }
}

/** Short name git commands accept. Includes the id because two workspaces can share a repo and a key. */
export const taskBranch = (task: Task) => `${PREFIX}${task.key}-${task.id}`;
const refOf = (branch: string) => REF_ROOT + branch;

async function commitAll(cwd: string, message: string): Promise<void> {
  if (!(await git(cwd, 'status', '--porcelain')).trim()) return;
  await git(cwd, 'add', '-A');
  // Everything may have been noise git drops on add (e.g. line endings only).
  if (!(await git(cwd, 'status', '--porcelain')).trim()) return;
  await git(cwd, ...COMMIT_AS_HUB, 'commit', '--no-verify', '--quiet', '-m', message);
}

async function saveAside(cwd: string, agentName: string, head: string): Promise<string> {
  const branch = `${PREFIX}saved/${agentName}-${Date.now()}`;
  await git(cwd, 'update-ref', refOf(branch), head);
  return branch;
}

/** Keep work in the worktree that no ref holds, before the worktree moves to another task. */
async function saveLeftovers(cwd: string, agentName: string): Promise<string | null> {
  await commitAll(cwd, `Work of ${agentName} outside a task`);
  const head = await commitOf(cwd, 'HEAD');
  if (!head || (await git(cwd, 'for-each-ref', '--count=1', '--contains', head)).trim()) return null;
  return saveAside(cwd, agentName, head);
}

/** Put the worktree on the task's code. Returns what the agent should know about it. */
export async function enterTask(repo: string, cwd: string, agentName: string, task: Task): Promise<string> {
  const branch = taskBranch(task);
  let base = task.baseCommit;
  let tip = await commitOf(cwd, refOf(branch));
  const isNew = !tip;
  if (!tip) {
    tip = (await git(repo, 'rev-parse', 'HEAD')).trim();
    base = tip;
    await git(cwd, 'update-ref', refOf(branch), tip);
    updateTask(task.id, { baseCommit: base });
  }
  // Changes left on the same task's own tip belong to the task, so they stay where they are.
  let saved: string | null = null;
  if (isNew || (await commitOf(cwd, 'HEAD')) !== tip) {
    saved = await saveLeftovers(cwd, agentName);
    await git(cwd, 'checkout', '--quiet', '--detach', tip);
  }
  return [
    `[Workspace: this folder is at the code of ${task.key}, with earlier steps' changes. All of them: git diff ${base}.`,
    'The hub saves your changes when the turn ends, so you do not need to commit. Stay on the current commit.',
    saved ? `Unsaved work found here earlier was kept as ${saved}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .concat(']');
}

/** Save the turn's changes to the task. Returns a warning when they could not go on the task's own branch. */
export async function leaveTask(cwd: string, agentName: string, task: Task): Promise<string | null> {
  await commitAll(cwd, `${task.key}: ${task.title}`);
  const ref = refOf(taskBranch(task));
  const head = await commitOf(cwd, 'HEAD');
  const tip = await commitOf(cwd, ref);
  if (!head || !tip || head === tip) return null;
  // The agent moved to another commit: following it would drop what earlier steps saved.
  if ((await git(cwd, 'merge-base', head, tip).catch(() => '')).trim() !== tip) {
    if ((await git(cwd, 'for-each-ref', '--count=1', '--contains', head)).trim()) return null;
    const saved = await saveAside(cwd, agentName, head);
    return `${agentName} left the code of ${task.key}, so this turn's changes are not part of the task. They are kept as ${saved}.`;
  }
  await git(cwd, 'update-ref', ref, head, tip);
  return null;
}

/** What the task changed so far, or null when it has no code of its own (no worktree agent worked on it). */
export async function taskChanges(repo: string, task: Task): Promise<TaskChanges | null> {
  const branch = taskBranch(task);
  if (!repo || !task.baseCommit) return null;
  const tip = await commitOf(repo, refOf(branch));
  if (!tip) return null;
  const range = ['--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', task.baseCommit, tip, '--'];
  // -z: one NUL-terminated "added<TAB>deleted<TAB>path" per file, with the path unquoted; "-" counts mean binary.
  const files: FileChange[] = (await git(repo, 'diff', '--numstat', '-z', ...range))
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...path] = line.split('\t');
      return { path: path.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0, patch: null };
    });
  return { branch, files: withPatches(files, await patches(repo, range)) };
}

/** One patch per file in numstat's order; none when the whole diff is too big to read. */
async function patches(repo: string, range: string[]): Promise<string[]> {
  try {
    // Content lines start with a space, + or -, so this only splits at file headers.
    return (await git(repo, 'diff', '--patch', ...range)).split(/^(?=diff --git )/m).filter(Boolean);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return [];
    throw err;
  }
}

function withPatches(files: FileChange[], texts: string[]): FileChange[] {
  if (texts.length !== files.length) return files;
  let budget = MAX_PATCH_CHARS;
  return files.map((file, i) => {
    const patch = texts[i]!;
    if (patch.length > budget) return file;
    budget -= patch.length;
    return { ...file, patch };
  });
}
