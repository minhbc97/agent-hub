/**
 * Workflow engine check with fake agents (no model calls):
 * writer -> editor (needs approval) -> rejected back to writer -> approved -> human publish step -> done.
 */
import {
  USER_ID,
  ENGINE,
  ISOLATION,
  MESSAGE_STATUS,
  TASK_STATUS,
  ROUTING,
  TRIGGER_KIND,
  RESET_POLICY,
} from '../src/shared/contracts.ts';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const dataDir = resolve('data/test-workflow');
rmSync(dataDir, { recursive: true, force: true });
process.env.HUB_DATA = dataDir;
const nodeCommand = `"${process.execPath}"`;

const db = await import('../src/server/db.ts');
const bus = await import('../src/server/bus.ts');
const wfe = await import('../src/server/workflow.ts');
const cron = await import('../src/server/cron.ts');

// cron sanity
assert.ok(cron.cronMatches('30 13 * * 1-5', new Date(2026, 10, 19, 13, 30)));
assert.ok(!cron.cronMatches('30 13 * * 1-5', new Date(2026, 10, 22, 13, 30)));
assert.ok(cron.cronMatches('0 9 * * 7', new Date(2026, 10, 22, 9, 0)));
assert.throws(() => cron.parseCron('61 * * * *'));

const work = resolve(dataDir, 'work');
mkdirSync(work, { recursive: true });
const ws = db.createWorkspace({ name: 'content' });
const fake = {
  workspaceId: ws.id,
  engine: ENGINE.custom,
  command: `${nodeCommand} "${resolve('scripts/fake-agent.mjs')}"`,
  isolation: ISOLATION.custom,
  cwd: work,
};
const writer = db.createAgent({ ...fake, name: 'writer' });
const editor = db.createAgent({ ...fake, name: 'editor' });

const wf = db.saveWorkflow({
  workspaceId: ws.id,
  name: 'Blog post',
  description: '',
  enabled: true,
  trigger: { kind: TRIGGER_KIND.manual, cron: '', title: '', body: '' },
  steps: [
    { id: 's1', name: 'Draft', agentId: writer.id, instruction: 'Write a draft', approval: false, onReject: null },
    { id: 's2', name: 'Edit', agentId: editor.id, instruction: 'Edit the draft', approval: true, onReject: 's1' },
    { id: 's3', name: 'Publish', agentId: null, instruction: 'Publish it yourself', approval: false, onReject: null },
  ],
});

const settle = async (workspaceId = ws.id) => {
  for (let i = 0; i < 100; i++) {
    bus.tick();
    await new Promise((r) => setTimeout(r, 150));
    const busy =
      bus.isBusy() ||
      db
        .listMessages(workspaceId)
        .some((m) => m.status === MESSAGE_STATUS.queued || m.status === MESSAGE_STATUS.running);
    if (!busy) {
      bus.tick();
      if (!bus.isBusy()) return;
    }
  }
  throw new Error('did not settle');
};

let task = wfe.runWorkflow(wf, 'Post about agents', 'Topic: agent teams');
await settle();
task = db.getTask(task.id)!;
assert.equal(task.stepId, 's2');
assert.equal(task.status, TASK_STATUS.review, 'editor step waits for approval');
assert.match(task.result, /editor finished/);

task = wfe.decide(task.id, false, 'Too short');
assert.equal(task.stepId, 's1', 'rejection goes back to Draft');
await settle();
task = db.getTask(task.id)!;
assert.equal(task.status, TASK_STATUS.review);
assert.equal(task.stepId, 's2');

task = wfe.decide(task.id, true, '');
assert.equal(task.stepId, 's3');
assert.equal(task.status, TASK_STATUS.review, 'human step waits for the human');
assert.equal(task.assigneeId, USER_ID);

task = wfe.decide(task.id, true, 'Published at example.com/post');
assert.equal(task.status, TASK_STATUS.done);
assert.equal(task.result, 'Published at example.com/post');

const rejected = db.listMessages(ws.id).filter((m) => m.status === MESSAGE_STATUS.failed);
assert.equal(rejected.length, 0, 'no failed messages');

// A finished task cannot be decided again; the error carries an i18n key, not prose.
assert.throws(() => wfe.decide(task.id, true, ''), { key: 'errors.taskNotAwaitingReview' });

// Task keys never come back after a delete, or a late "done" from an agent would hit the wrong task.
const last = db.createTask({ workspaceId: ws.id, title: 'temp' });
db.deleteTask(last.id);
assert.notEqual(db.createTask({ workspaceId: ws.id, title: 'next' }).key, last.key);

// Routing: star sends everything through the orchestrator; mesh lets listed pairs talk directly.
const pm = db.createAgent({ ...fake, name: 'pm', isOrchestrator: true });
const team = () => db.listAgents(ws.id);
const byName = (n: string) => team().find((a) => a.name === n)!;
assert.equal(bus.route(byName('writer'), byName('editor'), team(), db.getWorkspace(ws.id)!).name, 'pm');
assert.equal(bus.route(byName('pm'), byName('editor'), team(), db.getWorkspace(ws.id)!).name, 'editor');
db.updateWorkspace(ws.id, {
  settings: { ...db.getWorkspace(ws.id)!.settings, routing: ROUTING.mesh, directPairs: [['editor', 'writer']] },
});
assert.equal(bus.route(byName('writer'), byName('editor'), team(), db.getWorkspace(ws.id)!).name, 'editor');

// Agent invariants live in db.ts: one orchestrator; pairs follow renames and deletes.
db.updateAgent(writer.id, { isOrchestrator: true });
assert.equal(db.getAgent(pm.id)!.isOrchestrator, false);
db.updateAgent(editor.id, { name: 'reviewer' });
assert.deepEqual(db.getWorkspace(ws.id)!.settings.directPairs, [['reviewer', 'writer']]);
db.deleteAgent(pm.id);
db.deleteAgent(db.createAgent({ ...fake, name: 'temp' }).id);
assert.deepEqual(db.getWorkspace(ws.id)!.settings.directPairs, [['reviewer', 'writer']]);
db.updateWorkspace(ws.id, { settings: { ...db.getWorkspace(ws.id)!.settings, directPairs: [['temp2', 'writer']] } });
db.deleteAgent(db.createAgent({ ...fake, name: 'temp2' }).id);
assert.deepEqual(db.getWorkspace(ws.id)!.settings.directPairs, []);
db.updateAgent(editor.id, { name: 'editor' });

// A failed turn must not leave its task "doing" forever: it goes to the human's queue instead.
const broken = db.createAgent({ ...fake, name: 'broken', command: `${nodeCommand} -e "process.exit(3)"` });
const stuck = wfe.startTask(db.createTask({ workspaceId: ws.id, title: 'will fail', assigneeId: broken.id }));
assert.equal(stuck.status, TASK_STATUS.doing);
await settle();
const blocked = db.getTask(stuck.id)!;
assert.equal(blocked.status, TASK_STATUS.blocked, 'failed turn blocks the task');
assert.ok(blocked.waitingReason, 'the failure reason is shown to the human');
// Retry re-queues the failed message and puts the task back to work.
const failedMsg = db.listMessages(ws.id).find((m) => m.toId === broken.id && m.status === MESSAGE_STATUS.failed)!;
bus.stopBus();
const retried = bus.retryMessage(failedMsg.id);
assert.notEqual(retried.status, MESSAGE_STATUS.failed);
assert.equal(db.getTask(stuck.id)!.status, TASK_STATUS.doing, 'retry unblocks the task');
await settle();
assert.equal(db.getTask(stuck.id)!.status, TASK_STATUS.blocked, 'a second failure blocks again');
assert.throws(() => bus.retryMessage(retried.id + 'x'), { key: 'errors.messageNotRetryable' });
db.deleteAgent(broken.id);

// Restart: an interrupted turn is failed for the human to retry, never silently rerun.
const interrupted = db.createMessage({
  workspaceId: ws.id,
  fromId: USER_ID,
  toId: writer.id,
  act: 'request',
  body: 'x',
});
db.setMessageStatus(interrupted.id, MESSAGE_STATUS.running);
assert.deepEqual(
  db.failInterrupted().map((m) => m.id),
  [interrupted.id],
);
assert.equal(db.getMessage(interrupted.id)!.status, MESSAGE_STATUS.failed);

// Worktree isolation needs a git repo with a commit; the agent form says so instead of failing on the first turn.
{
  const { agentFields } = await import('../src/server/api/validation.ts');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  // Outside this checkout: inside it, git would find agent-hub's own repo and the folder would count as git.
  const plain = mkdtempSync(resolve(tmpdir(), 'agent-hub-nogit-'));
  const gitless = db.createWorkspace({ name: 'gitless', repoPath: plain });
  assert.throws(() => agentFields({ name: 'w1', isolation: ISOLATION.worktree }, gitless.id, null), {
    key: 'errors.worktreeNeedsGit',
  });
  assert.doesNotThrow(() => agentFields({ name: 'w1', isolation: ISOLATION.shared }, gitless.id, null));
  const noRepo = db.createWorkspace({ name: 'norepo' });
  assert.throws(() => agentFields({ name: 'w1', isolation: ISOLATION.worktree }, noRepo.id, null), {
    key: 'errors.worktreeNeedsRepo',
  });
  // Without a choice, a new agent gets what the folder supports: no git means the shared folder.
  assert.equal(agentFields({ name: 'w1' }, noRepo.id, null).isolation, ISOLATION.shared);
  assert.equal(agentFields({ name: 'w1' }, gitless.id, null).isolation, ISOLATION.shared);
  execFileSync('git', ['init', '-q', plain]);
  execFileSync('git', [
    '-C',
    plain,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  ]);
  assert.doesNotThrow(() => agentFields({ name: 'w1', isolation: ISOLATION.worktree }, gitless.id, null));
  assert.equal(agentFields({ name: 'w1' }, gitless.id, null).isolation, ISOLATION.worktree);
  rmSync(plain, { recursive: true, force: true });
}

// needs_human options: cleaned at the outbox boundary and stored as a list.
assert.deepEqual(bus.askOptions([' Yes ', '', 'Yes', 42, 'No']), ['Yes', 'No']);
assert.deepEqual(bus.askOptions('Yes'), []);
assert.equal(bus.askOptions(Array.from({ length: 10 }, (_, i) => `choice ${i}`)).length, 6);
assert.equal(bus.askOptions(['x'.repeat(500)])[0]!.length, 160);
const asked = db.createMessage({
  workspaceId: ws.id,
  fromId: writer.id,
  toId: USER_ID,
  act: 'needs_human',
  body: 'Which one?',
  options: ['A', 'B'],
  status: MESSAGE_STATUS.held,
});
assert.deepEqual(db.getMessage(asked.id)!.options, ['A', 'B']);
assert.deepEqual(db.getMessage(interrupted.id)!.options, [], 'messages without options read as an empty list');

// Outbox: an oversized file is rejected unread; a valid file is queued exactly once.
const { outboxDir } = await import('../src/server/runner.ts');
const { existsSync, readdirSync, writeFileSync } = await import('node:fs');
const box = outboxDir(writer.id);
writeFileSync(resolve(box, 'big.json'), ' '.repeat(300 * 1024));
writeFileSync(resolve(box, 'ok.json'), JSON.stringify({ to: 'user', act: 'inform', subject: 'outbox ok', body: 'hi' }));
bus.tick();
bus.tick();
assert.equal(db.listMessages(ws.id).filter((m) => m.subject === 'outbox ok').length, 1);
assert.ok(readdirSync(resolve(box, 'rejected')).some((f) => f.endsWith('big.json')));
assert.ok(!existsSync(resolve(box, 'ok.json')) && !existsSync(resolve(box, 'big.json')));
// A rejected file is reported to the human, who would otherwise never learn the agent's message was lost.
assert.ok(
  db
    .listMessages(ws.id)
    .some(
      (m) => m.fromId === 'hub' && m.toId === USER_ID && m.body.includes('big.json') && m.subject.includes('rejected'),
    ),
);
// An "ASK ME" style question with task "new" stays a question (no card) instead of being dropped.
writeFileSync(
  resolve(box, 'ask.json'),
  JSON.stringify({
    to: 'user',
    act: 'needs_human',
    task: 'new',
    subject: 'ask card',
    body: 'Which?',
    options: ['A', 'B'],
  }),
);
bus.tick();
const askCard = db.listMessages(ws.id).find((m) => m.subject === 'ask card');
assert.ok(askCard, 'needs_human with task "new" is accepted');
assert.equal(askCard.taskId, null);
assert.deepEqual(askCard.options, ['A', 'B']);
assert.equal(askCard.status, MESSAGE_STATUS.held);

// Model overrides: bad rows are dropped, a missing label falls back to the id.
const { parseOverrides } = await import('../src/server/engines/catalog.ts');
assert.deepEqual(parseOverrides({ claude: [{ id: ' m1 ' }, { label: 'no id' }, 3], codex: 'x' }), {
  claude: [{ id: 'm1', label: 'm1' }],
});
assert.deepEqual(parseOverrides([]), {});

// Claude turns always carry the git backstop.
const { claude } = await import('../src/server/engines/claude.ts');
assert.match(
  claude.command(db.getAgent(writer.id)!, { resumeId: null, extraDirs: [] }),
  /--disallowedTools .*git push/,
);

// Loop guard: two agents pinging each other stop after maxHops; Retry lets one more round through.
const loops = db.createWorkspace({ name: 'loops' });
db.updateWorkspace(loops.id, { settings: { ...db.getWorkspace(loops.id)!.settings, maxHops: 3 } });
const loopAgent = { ...fake, workspaceId: loops.id };
db.createAgent({ ...loopAgent, name: 'ping' });
db.createAgent({ ...loopAgent, name: 'pong' });
bus.sendFromUser(loops.id, 'ping', 'ping-pong with pong');
await settle(loops.id);
const agentMail = () => db.listMessages(loops.id).filter((m) => m.fromId !== USER_ID && m.act === 'request');
const stopped = agentMail().filter((m) => m.status === MESSAGE_STATUS.failed);
assert.equal(agentMail().length, 4, 'three hops delivered, the fourth stopped');
assert.equal(stopped.length, 1);
assert.match(stopped[0]!.holdReason ?? '', /loop guard/);
bus.retryMessage(stopped[0]!.id);
await settle(loops.id);
// The released message is hop 1 of the new chain: two more go through, the next one stops again.
assert.equal(agentMail().length, 7);
assert.equal(agentMail().filter((m) => m.status === MESSAGE_STATUS.failed).length, 1);

// Messages waiting for an agent run together in one turn.
db.updateAgent(editor.id, { paused: true });
const waiting = [bus.sendFromUser(ws.id, 'editor', 'first note'), bus.sendFromUser(ws.id, 'editor', 'second note')];
await settle();
const editorRuns = db.listRuns(editor.id).length;
db.updateAgent(editor.id, { paused: false });
await settle();
assert.equal(db.listRuns(editor.id).length, editorRuns + 1, 'both waiting messages share one turn');
const [firstNote, secondNote] = waiting.map((m) => db.getMessage(m.id)!);
assert.equal(firstNote!.status, MESSAGE_STATUS.delivered);
assert.equal(firstNote!.runId, secondNote!.runId);

// Codex: usage on resume is the thread's running total; runs must store per-turn numbers.
const coder = db.createAgent({
  ...fake,
  name: 'coder',
  engine: ENGINE.codex,
  command: `${nodeCommand} "${resolve('scripts/fake-codex.mjs')}"`,
  extraArgs: '',
});
bus.sendFromUser(ws.id, 'coder', 'first');
await settle();
bus.sendFromUser(ws.id, 'coder', 'second');
await settle();
const [second, first] = db.listRuns(coder.id);
assert.equal(db.getAgent(coder.id)!.sessionId, 'thread-1');
assert.deepEqual(
  [first!.inputTokens, first!.cacheReadTokens, first!.outputTokens, first!.output],
  [100, 0, 10, 'first'],
);
assert.deepEqual(
  [second!.inputTokens, second!.cacheReadTokens, second!.outputTokens, second!.output],
  [100, 100, 20, 'second'],
);
// A CLI that reports its turn done but never exits is ended after a short grace, not left to the 30 min timeout.
const lingerStart = Date.now();
bus.sendFromUser(ws.id, 'coder', 'linger');
await settle();
const lingered = db.listRuns(coder.id)[0]!;
assert.equal(lingered.status, 'ok', 'a turn the CLI finished counts as success');
assert.ok(Date.now() - lingerStart < 20_000);

// A budget stored by an older release no longer holds new work.
db.openDb().prepare('UPDATE agents SET dailyTokenBudget = 1 WHERE id = ?').run(coder.id);
const afterLegacyBudget = bus.sendFromUser(ws.id, 'coder', 'third');
await settle();
assert.equal(db.getMessage(afterLegacyBudget.id)!.status, MESSAGE_STATUS.delivered);

// Rotation past the turn limit: a handoff turn on the old thread, then the message runs in a new one.
db.updateAgent(coder.id, { resetPolicy: RESET_POLICY.turns, resetValue: 2 });
const runsBefore = db.listRuns(coder.id).length;
bus.sendFromUser(ws.id, 'coder', 'after the limit');
await settle();
const [afterRotation, handoffRun] = db.listRuns(coder.id);
assert.equal(db.listRuns(coder.id).length, runsBefore + 2, 'one handoff run plus the turn itself');
assert.equal(handoffRun!.output, 'second', 'the handoff note is asked in the old thread');
assert.equal(afterRotation!.output, 'first', 'the message itself starts a new thread');
assert.equal(db.getAgent(coder.id)!.handoff, 'second');
assert.equal(db.getAgent(coder.id)!.turnsInSession, 1);
// Idle rotation: a session whose last turn ended over an hour ago is rotated whatever the policy.
db.updateAgent(coder.id, { resetPolicy: RESET_POLICY.never, resetValue: 0 });
db.openDb()
  .prepare('UPDATE runs SET endedAt = ? WHERE agentId = ?')
  .run(new Date(Date.now() - 2 * 3600_000).toISOString(), coder.id);
const idleRuns = db.listRuns(coder.id).length;
bus.sendFromUser(ws.id, 'coder', 'after a long break');
await settle();
assert.equal(db.listRuns(coder.id).length, idleRuns + 2, 'idle session rotated before the turn');

// Out of quota: the message is held until the engine's reset instead of failing, then runs by itself.
const availability = await import('../src/server/availability.ts');
process.env.FAKE_CODEX_QUOTA = '1';
const quotaMsg = bus.sendFromUser(ws.id, 'coder', 'during the outage');
for (let i = 0; i < 50 && db.getMessage(quotaMsg.id)!.status !== MESSAGE_STATUS.held; i++) {
  bus.tick();
  await new Promise((r) => setTimeout(r, 150));
}
assert.equal(db.getMessage(quotaMsg.id)!.status, MESSAGE_STATUS.held, 'held, not failed');
assert.match(db.getMessage(quotaMsg.id)!.holdReason ?? '', /codex quota reached; retrying at/);
const blockedFor = availability.engineBlock(ENGINE.codex)!.until - Date.now();
assert.ok(blockedFor > 55 * 60_000 && blockedFor <= 3600_000, 'blocked until the reset the CLI reported');
// A fallback takes over while the main engine is blocked; without one the mail waits.
assert.equal(bus.pickEngine({ ...db.getAgent(coder.id)!, fallbackEngine: ENGINE.claude }), ENGINE.claude);
assert.ok(typeof bus.pickEngine(db.getAgent(coder.id)!) === 'object');
delete process.env.FAKE_CODEX_QUOTA;
availability.blockEngine(ENGINE.codex, 'test reset', 0);
await settle();
assert.equal(db.getMessage(quotaMsg.id)!.status, MESSAGE_STATUS.delivered, 'runs by itself after the reset');
db.deleteAgent(coder.id);

// HTTP layer: the UI sends agent ids; a broken %-escape must answer 400, not crash the process.
const { createServer } = await import('node:http');
const { handleApi } = await import('../src/server/api.ts');
const server = createServer((req, res) => void handleApi(req, res));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
bus.stopBus();
const sent = await fetch(`${base}/api/workspaces/${ws.id}/messages`, {
  method: 'POST',
  body: JSON.stringify({ to: writer.id, body: 'hello by id', urgent: false }),
});
assert.equal(sent.status, 200, 'send by agent id');
// The lead agent is mandatory, and an agent's goal reaches its first-turn briefing.
assert.equal((await fetch(`${base}/api/agents/${writer.id}`, { method: 'DELETE' })).status, 409);
const withGoal = await fetch(`${base}/api/agents/${writer.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ goal: 'ship weekly posts' }),
});
assert.equal(withGoal.status, 200);
// Moving the repo folder drops sessions tied to it; agents with their own folder keep theirs.
const movingWs = db.createWorkspace({ name: 'moving' });
const inRepo = db.createAgent({ ...fake, workspaceId: movingWs.id, name: 'inrepo', isolation: ISOLATION.shared });
const ownFolder = db.createAgent({ ...fake, workspaceId: movingWs.id, name: 'ownfolder' });
db.updateAgent(inRepo.id, { sessionId: 'old-session', turnsInSession: 3 });
db.updateAgent(ownFolder.id, { sessionId: 'own-folder-session' });
const moved = await fetch(`${base}/api/workspaces/${movingWs.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ repoPath: work }),
});
assert.equal(moved.status, 200);
assert.equal(db.getAgent(inRepo.id)!.sessionId, null);
assert.equal(db.getAgent(ownFolder.id)!.sessionId, 'own-folder-session');
db.deleteWorkspace(movingWs.id);
const { preamble } = await import('../src/server/preamble.ts');
const lead = db.getAgent(writer.id)!;
assert.ok(preamble(lead, team(), db.getWorkspace(ws.id)!, 'outbox').includes('Your goal:\nship weekly posts'));
// A fresh session carries the handoff note, inlined briefs and open tasks instead of rediscovering them.
const openTask = db.createTask({ workspaceId: ws.id, title: 'carried task', assigneeId: writer.id });
const carried = preamble({ ...lead, handoff: 'pick up T-9' }, team(), db.getWorkspace(ws.id)!, 'outbox', {
  briefs: [
    { path: 'pm.md', content: 'be brief' },
    { path: 'huge.md', content: null },
  ],
  openTasks: [openTask],
});
assert.ok(carried.includes('Brief file pm.md (already loaded, do not read it again):\nbe brief'));
assert.ok(carried.includes('Read these brief files before working: huge.md'));
assert.ok(carried.includes('Handoff note from your previous session:\npick up T-9'));
assert.ok(carried.includes(`- ${openTask.key} [${openTask.status}] carried task`));
const badPath = await fetch(`${base}/api/tasks/%E0%A4%A`, { method: 'DELETE' });
assert.equal(badPath.status, 400);
// DNS rebinding: a foreign Host header is refused even when Origin matches it.
const { request } = await import('node:http');
const rebound = await new Promise<number>((done, fail) =>
  request(`${base}/api/workspaces`, { headers: { host: 'evil.example', origin: 'http://evil.example' } }, (res) => {
    res.resume();
    done(res.statusCode ?? 0);
  })
    .on('error', fail)
    .end(),
);
assert.equal(rebound, 403, 'foreign Host is refused');
assert.equal((await fetch(`${base}/api/workspaces`)).status, 200, 'server still alive');
server.closeAllConnections();
await new Promise((r) => server.close(r));
console.log('workflow test: PASS');
