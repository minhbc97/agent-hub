/** Code handover between worktree agents, on a real git repo with fake agents (no model calls). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENGINE, ISOLATION, MESSAGE_STATUS, TASK_STATUS, TRIGGER_KIND } from '../src/shared/contracts.ts';

const dataDir = resolve('data/test-task-branch');
rmSync(dataDir, { recursive: true, force: true });
process.env.HUB_DATA = dataDir;
const db = await import('../src/server/db.ts');
const bus = await import('../src/server/bus.ts');
const wfe = await import('../src/server/workflow.ts');
const { taskBranch, taskChanges } = await import('../src/server/task-branch.ts');

const repo = resolve(dataDir, 'repo');
const trees = resolve(dataDir, 'trees');
mkdirSync(repo, { recursive: true });
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const commit = (message: string) => {
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
};
git(repo, 'init', '-q');
git(repo, 'config', 'core.autocrlf', 'false');
writeFileSync(resolve(repo, 'main.txt'), 'one\n');
commit('first');

const ws = db.createWorkspace({ name: 'code', repoPath: repo, worktreesDir: trees });
const fake = {
  workspaceId: ws.id,
  engine: ENGINE.custom,
  command: `"${process.execPath}" "${resolve('scripts/fake-coder.mjs')}"`,
  isolation: ISOLATION.worktree,
};
const dev = db.createAgent({ ...fake, name: 'dev' });
const reviewer = db.createAgent({ ...fake, name: 'reviewer' });
const devTree = resolve(trees, 'dev');
const settle = async () => {
  for (let i = 0; i < 200; i++) {
    bus.tick();
    await new Promise((r) => setTimeout(r, 100));
    const isWaiting = db
      .listMessages(ws.id)
      .some((m) => m.status === MESSAGE_STATUS.queued || m.status === MESSAGE_STATUS.running);
    if (!isWaiting && !bus.isBusy()) return;
  }
  throw new Error('did not settle');
};
const step = (id: string, agentId: string, instruction: string, approval = false) => ({
  id,
  name: id,
  agentId,
  instruction,
  approval,
  onReject: 'build',
});
const wf = db.saveWorkflow({
  workspaceId: ws.id,
  name: 'ship',
  description: '',
  enabled: true,
  trigger: { kind: TRIGGER_KIND.manual, cron: '', title: '', body: '' },
  steps: [step('build', dev.id, '[write dev.txt]'), step('review', reviewer.id, '[list]', true)],
});

// The reviewer's own worktree holds what the developer wrote, though nobody committed anything.
const first = wfe.runWorkflow(wf, 'first', '');
await settle();
assert.equal(db.getTask(first.id)!.status, TASK_STATUS.review);
assert.match(db.getTask(first.id)!.result, /reviewer sees .*dev\.txt/);
const changes = (await taskChanges(repo, db.getTask(first.id)!))!;
assert.deepEqual(
  changes.files.map((f) => [f.path, f.added, f.deleted]),
  [['dev.txt', 1, 0]],
);
assert.match(changes.files[0]!.patch!, /\+dev/);
// The human's checkout is untouched, and the ref is not a branch that could move under them or be pushed.
assert.ok(!existsSync(resolve(repo, 'dev.txt')));
assert.equal(git(repo, 'status', '--porcelain'), '');
assert.equal(git(repo, 'branch', '--list', '*agent-hub*'), '');

// Sent back: the developer continues from its earlier work.
wfe.decide(first.id, false, 'again');
await settle();
assert.equal((await taskChanges(repo, db.getTask(first.id)!))!.files[0]!.added, 2);

// A new task starts from the repo's current HEAD, without the other task's files. Loose work is kept aside.
writeFileSync(resolve(repo, 'main.txt'), 'two\n');
commit('second');
writeFileSync(resolve(devTree, 'loose.txt'), 'loose\n');
const second = wfe.startTask(
  db.createTask({ workspaceId: ws.id, title: 'second', body: '[write other.txt]', assigneeId: dev.id }),
);
await settle();
assert.equal(db.getTask(second.id)!.status, TASK_STATUS.done);
assert.ok(!existsSync(resolve(devTree, 'dev.txt')) && !existsSync(resolve(devTree, 'loose.txt')));
assert.equal(readFileSync(resolve(devTree, 'main.txt'), 'utf8'), 'two\n');
assert.deepEqual(
  (await taskChanges(repo, db.getTask(second.id)!))!.files.map((f) => f.path),
  ['other.txt'],
);
const saved = git(repo, 'for-each-ref', '--format=%(refname)', 'refs/agent-hub/saved');
assert.match(saved, /saved\/dev-\d+$/);
assert.match(git(repo, 'show', '--stat', saved), /loose\.txt/);

// An agent that wanders off to another commit cannot drop the task's earlier work.
const wander = wfe.startTask(
  db.createTask({ workspaceId: ws.id, title: 'wander', body: '[write kept.txt] [wander]', assigneeId: dev.id }),
);
await settle();
bus.sendFromUser(ws.id, 'dev', 'plain chat leaves the folder alone');
await settle();
assert.equal(db.getTask(wander.id)!.status, TASK_STATUS.done);
assert.deepEqual((await taskChanges(repo, db.getTask(wander.id)!))!.files, []);
assert.ok(db.listMessages(ws.id).some((m) => m.body.includes('not part of the task')));

// The command the UI shows brings the work into the human's branch.
git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', '--no-edit', taskBranch(second));
assert.ok(existsSync(resolve(repo, 'other.txt')));

// Waiting mail of two tasks cannot share one turn: the folder is at one task's code at a time.
db.updateAgent(dev.id, { paused: true });
const pair = ['x', 'y'].map((name) =>
  wfe.startTask(db.createTask({ workspaceId: ws.id, title: name, body: `[write ${name}.txt]`, assigneeId: dev.id })),
);
db.updateAgent(dev.id, { paused: false });
await settle();
for (const [i, name] of ['x', 'y'].entries())
  assert.deepEqual(
    (await taskChanges(repo, db.getTask(pair[i]!.id)!))!.files.map((f) => f.path),
    [`${name}.txt`],
  );

// A folder left by another repository is refused instead of being worked in.
mkdirSync(resolve(trees, 'stray'), { recursive: true });
git(resolve(trees, 'stray'), 'init', '-q');
const stray = db.createAgent({ ...fake, name: 'stray' });
bus.sendFromUser(ws.id, 'stray', 'hello');
await settle();
assert.match(db.listRuns(stray.id)[0]!.output, /is not a worktree of/);

// Shared-folder agents work as before and have no changes to show.
const shared = db.createAgent({ ...fake, name: 'shared', isolation: ISOLATION.shared });
const plain = wfe.startTask(db.createTask({ workspaceId: ws.id, title: 'plain', assigneeId: shared.id }));
await settle();
assert.equal(db.getTask(plain.id)!.status, TASK_STATUS.done);
assert.equal(await taskChanges(repo, db.getTask(plain.id)!), null);

console.log('task branch test: PASS');
