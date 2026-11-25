/** Live output of a turn: engine events become readable lines, secrets stay hidden, the buffer stays bounded. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ENGINE,
  ISOLATION,
  MESSAGE_STATUS,
  RUN_STATUS,
  TERMINAL_KIND,
  TERMINAL_MAX_ENTRIES,
  type TerminalOutput,
} from '../src/shared/contracts.ts';

const dataDir = resolve('data/test-terminal');
rmSync(dataDir, { recursive: true, force: true });
process.env.HUB_DATA = dataDir;
process.env.TEST_SERVICE_TOKEN = 'plain-words-from-env';

const db = await import('../src/server/db.ts');
const bus = await import('../src/server/bus.ts');
const { hubEvents } = await import('../src/server/events.ts');
const { openTerminal, redact, terminalOutput } = await import('../src/server/terminal.ts');
const { codex } = await import('../src/server/engines/codex.ts');
const { handleApi } = await import('../src/server/api.ts');

// Secrets, each in a form agents really print. Built here so the file itself holds nothing token-shaped.
const body = 'a1B2c3D4e5F6g7H8i9J0';
const secrets: [printed: string, secret: string][] = [
  [`key sk-ant-${body}`, body],
  [`push ghp_${body}`, body],
  ['git remote https://me:p4ssw0rd@host/x.git', 'p4ssw0rd'],
  ['curl -H "Authorization: Bearer abcdef123456"', 'abcdef123456'],
  ['{"password":"hunter22"}', 'hunter22'],
  ['{\\"apiKey\\": \\"hunter22\\"}', 'hunter22'],
  ['MOMO_PARTNER=abc-def\nOTHER=1', 'abc-def'],
  ['    12\tSMTP_PASS=abc-def', 'abc-def'],
  ['-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----', 'MIIEabc'],
  ['M'.repeat(64), 'M'.repeat(64)],
  ['env says plain-words-from-env', 'plain-words-from-env'],
];
for (const [printed, secret] of secrets) assert.ok(!redact(printed).includes(secret), `hidden: ${printed}`);
for (const plain of ['Fixed the login token check', 'npm run build -- --mode=prod', 'https://host:4310/a?b=c'])
  assert.equal(redact(plain), plain);

// Codex events.
const describe = (event: Record<string, unknown>) => codex.describe!(event);
assert.deepEqual(describe({ type: 'item.started', item: { type: 'command_execution', command: 'npm test' } }), [
  { kind: TERMINAL_KIND.shell, text: 'npm test' },
]);
assert.deepEqual(
  describe({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'boom', exit_code: 1 } }),
  [{ kind: TERMINAL_KIND.error, text: 'boom' }],
);
assert.deepEqual(
  describe({ type: 'item.completed', item: { type: 'file_change', changes: [{ kind: 'update', path: 'a.ts' }] } }),
  [{ kind: TERMINAL_KIND.tool, text: 'update a.ts' }],
);
assert.deepEqual(describe({ type: 'turn.failed', error: { message: 'limit' } }), [
  { kind: TERMINAL_KIND.error, text: 'limit' },
]);
assert.deepEqual(describe({ type: 'turn.completed', usage: {} }), []);

// A whole turn of a Claude agent through the bus.
const work = resolve(dataDir, 'work');
mkdirSync(work, { recursive: true });
const ws = db.createWorkspace({ name: 'terminal' });
const agent = db.createAgent({
  workspaceId: ws.id,
  name: 'viewer',
  engine: ENGINE.claude,
  command: `"${process.execPath}" "${resolve('scripts/fake-claude.mjs')}"`,
  isolation: ISOLATION.custom,
  cwd: work,
});
assert.deepEqual(terminalOutput(agent.id, '', 0).entries, [], 'no turn yet');

const liveStatuses = new Set<string | null>();
hubEvents.on('change', (event: { type: string; id?: string }) => {
  if (event.type === 'terminal' && event.id === agent.id) liveStatuses.add(terminalOutput(agent.id, '', 0).status);
});
process.env.FAKE_CLAUDE_STEP_MS = '60';
const message = bus.sendFromUser(ws.id, agent.name, 'go, token=hunter22');
for (let i = 0; i < 100 && db.getMessage(message.id)!.status !== MESSAGE_STATUS.delivered; i++) {
  bus.tick();
  await new Promise((r) => setTimeout(r, 100));
}
assert.deepEqual([...liveStatuses], [RUN_STATUS.running, RUN_STATUS.ok], 'told while running and at the end');

const full = terminalOutput(agent.id, '', 0);
assert.deepEqual(
  full.entries.map((e) => [e.kind, e.text]),
  [
    [TERMINAL_KIND.input, 'user: go, token=[redacted]'],
    [TERMINAL_KIND.start, 'fake-model'],
    [TERMINAL_KIND.thinking, 'Look at the config first.'],
    [TERMINAL_KIND.tool, 'Read src/config.ts'],
    [TERMINAL_KIND.output, 'export const port = 4310;'],
    [TERMINAL_KIND.shell, 'cat .env'],
    [TERMINAL_KIND.output, 'SMTP_HOST=[redacted]\nDB_PASSWORD=[redacted]'],
    [TERMINAL_KIND.shell, 'npm test'],
    [TERMINAL_KIND.error, '1 test failed'],
    [TERMINAL_KIND.text, 'All done.'],
  ],
);
assert.equal(full.cwd, work);
assert.equal(db.listRuns(agent.id)[0]!.output, 'All done.', 'the stored answer is the result');

// While the turn runs, the user's chat joins it; mail about another task or from a paused agent's user waits.
const until = async (isDone: () => boolean) => {
  for (let i = 0; i < 100 && !isDone(); i++) {
    bus.tick();
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(isDone());
};
const statusOf = (id: string) => db.getMessage(id)!.status;
const isAtWork = () => {
  const { status, entries } = terminalOutput(agent.id, '', 0);
  return status === RUN_STATUS.running && entries.some((e) => e.kind === TERMINAL_KIND.tool);
};
const runsBefore = db.listRuns(agent.id).length;
const opening = bus.sendFromUser(ws.id, agent.name, 'start');
await until(isAtWork);
const otherTask = db.createTask({ workspaceId: ws.id, title: 'other' });
const elsewhere = bus.sendFromUser(ws.id, agent.name, 'for later', { taskId: otherTask.id });
const steered = bus.sendFromUser(ws.id, agent.name, 'use port 5000');
bus.tick();
assert.equal(statusOf(steered.id), MESSAGE_STATUS.running, 'handed to the running turn');
assert.equal(statusOf(elsewhere.id), MESSAGE_STATUS.queued, 'another task waits');
db.updateAgent(agent.id, { paused: true });
const whilePaused = bus.sendFromUser(ws.id, agent.name, 'not now');
bus.tick();
assert.equal(statusOf(whilePaused.id), MESSAGE_STATUS.queued, 'a paused agent gets nothing new');
await until(() => statusOf(opening.id) === MESSAGE_STATUS.delivered);
assert.equal(statusOf(steered.id), MESSAGE_STATUS.delivered);
const steeredRun = db.listRuns(agent.id)[0]!;
assert.equal(db.listRuns(agent.id).length, runsBefore + 1, 'one turn for both');
assert.equal(steeredRun.output, 'All done. Noted: use port 5000.');
assert.equal(db.getMessage(steered.id)!.runId, steeredRun.id);
const steeredEntries = terminalOutput(agent.id, '', 0).entries;
assert.ok(steeredEntries.some((e) => e.kind === TERMINAL_KIND.input && e.text === 'user: use port 5000'));
assert.ok(!steeredEntries.some((e) => /live-[0-9a-f]{12}/.test(e.text)), 'the code of the turn is not shown');
db.updateAgent(agent.id, { paused: false });
await until(() => [elsewhere, whilePaused].every((m) => statusOf(m.id) === MESSAGE_STATUS.delivered));

// Never read, because the CLI died: it is not lost and not failed, the next turn gets it.
process.env.FAKE_CLAUDE_DEAF = '1';
const doomed = bus.sendFromUser(ws.id, agent.name, 'start');
await until(isAtWork);
const unheard = bus.sendFromUser(ws.id, agent.name, 'are you there');
bus.tick();
assert.equal(statusOf(unheard.id), MESSAGE_STATUS.running);
delete process.env.FAKE_CLAUDE_DEAF;
await until(() => statusOf(doomed.id) === MESSAGE_STATUS.failed);
await until(() => statusOf(unheard.id) === MESSAGE_STATUS.delivered);

// A message sent in the gap after the answer is read in a round of its own, and stdin closes only after that.
const { liveInput } = await import('../src/server/live-input.ts');
const { claude } = await import('../src/server/engines/claude.ts');
const { PassThrough } = await import('node:stream');
const stdin = new PassThrough();
const written: string[] = [];
stdin.setEncoding('utf8').on('data', (chunk: string) => written.push(chunk));
const gap = liveInput(claude.live!, 'prompt');
assert.equal(gap.send('m0', 'too early'), false);
gap.attach(stdin);
assert.equal(gap.send('m1', 'late'), true);
gap.stdout('{"type":"result","result":"a"}\n');
assert.deepEqual([stdin.writableEnded, gap.unread()], [false, ['m1']]);
await new Promise((r) => setImmediate(r));
const lateEvent = JSON.parse(written.join('').trim().split('\n')[1]!) as object;
gap.stdout(`${JSON.stringify({ ...lateEvent, isReplay: true })}\n{"type":"result","result":"b"}\n`);
assert.deepEqual([stdin.writableEnded, gap.unread()], [true, []]);
assert.equal(gap.send('m2', 'after the end'), false);

const shown = terminalOutput(agent.id, '', 0);
// HTTP: the page asks only for what it has not seen; another run's id gets everything.
const server = createServer((req, res) => void handleApi(req, res));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/agents`;
const get = async (query: string) =>
  (await (await fetch(`${base}/${agent.id}/terminal${query}`)).json()) as TerminalOutput;
assert.equal((await get('')).entries.length, shown.entries.length);
assert.deepEqual(
  (await get(`?run=${shown.runId}&after=${shown.entries.length - 2}`)).entries.map((e) => e.seq),
  [shown.entries.length - 1, shown.entries.length],
);
assert.equal((await get('?run=older&after=7')).entries.length, shown.entries.length);
assert.equal((await fetch(`${base}/nobody/terminal`)).status, 404);
server.close();
bus.stopBus();

// Chunks split anywhere, long entries and long turns.
const run = db.listRuns(agent.id)[0]!;
const broken = openTerminal(agent, run, [], undefined);
broken.stdout('first \x1b[31mre');
broken.stdout('d\x1b[0m\r\nsecond');
broken.stderr('warning\n');
broken.end(RUN_STATUS.failed, 'exit 1');
assert.deepEqual(
  terminalOutput(agent.id, '', 0).entries.map((e) => [e.kind, e.text]),
  [
    [TERMINAL_KIND.text, 'first red'],
    [TERMINAL_KIND.error, 'warning'],
    [TERMINAL_KIND.text, 'second'],
    [TERMINAL_KIND.error, 'exit 1'],
  ],
);
const chatty = openTerminal(agent, run, [], undefined);
for (let i = 0; i < 700; i++) chatty.stdout(`line ${i}\n`);
chatty.stdout('x '.repeat(20_000) + '\n');
for (let i = 0; i < 5; i++) chatty.stdout('y'.repeat(1_000_000));
chatty.stdout('\nafter\n');
chatty.end(RUN_STATUS.ok, '');
const kept = terminalOutput(agent.id, '', 0);
assert.equal(kept.entries.length, TERMINAL_MAX_ENTRIES);
assert.equal(kept.droppedEntries, 202);
assert.ok(kept.entries.at(-2)!.text.length < 5000, 'long entry is cut');
assert.equal(kept.entries.at(-1)!.text, 'after', 'an endless line is skipped, what follows is kept');

console.log('Terminal checks passed.');
