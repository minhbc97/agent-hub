import { USER_ID, ENGINE, ISOLATION, ACT, MESSAGE_STATUS } from '../src/shared/contracts.ts';
/**
 * End-to-end check of the Claude runner and the outbox bus: user -> pm -> be -> pm -> user.
 * Uses its own data dir (data/demo) and a cheap model. Run: npm run demo:pm-be [-- --model haiku]
 */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = resolve('data/demo');
rmSync(dataDir, { recursive: true, force: true });
process.env.HUB_DATA = dataDir;

const modelArg = process.argv.indexOf('--model');
const model = modelArg > 0 ? process.argv[modelArg + 1]! : 'haiku';

const db = await import('../src/server/db.ts');
const bus = await import('../src/server/bus.ts');

const work = resolve(dataDir, 'work');
mkdirSync(work, { recursive: true });

const ws = db.createWorkspace({ name: 'demo' });
const common = {
  workspaceId: ws.id,
  engine: ENGINE.claude,
  model,
  isolation: ISOLATION.custom,
  cwd: work,
  // Headless turns cannot answer permission prompts; let the agent write files (its outbox included).
  extraArgs: '--permission-mode acceptEdits',
};
db.createAgent({
  ...common,
  name: 'pm',
  isOrchestrator: true,
  role: 'Project manager. You split work, delegate to teammates through the outbox, and report results to the user.',
});
db.createAgent({
  ...common,
  name: 'be',
  role: 'Backend engineer. You do the work you are asked and report back to the requester through the outbox.',
});

bus.sendFromUser(
  ws.id,
  'pm',
  'Ask be to compute 17 * 23 and to send the answer back to you. When be has answered, send the user an ' +
    '"inform" message with the result, then send the user a "done" message. Do not compute it yourself.',
);

const deadline = Date.now() + 8 * 60_000;
const settled = () =>
  !bus.isBusy() &&
  db
    .listMessages(ws.id)
    .every((m) => m.status === MESSAGE_STATUS.delivered || m.status === MESSAGE_STATUS.failed || m.toId === USER_ID);

bus.startBus(1000);
await new Promise<void>((done) => {
  const t = setInterval(() => {
    // Settled twice in a row so a just-finished turn's outbox is collected first.
    if ((settled() && (bus.tick(), settled())) || Date.now() > deadline) {
      clearInterval(t);
      done();
    }
  }, 2000);
});
bus.stopBus();

const agents = db.listAgents(ws.id);
const nameOf = (id: string) => (id === USER_ID ? USER_ID : (agents.find((a) => a.id === id)?.name ?? id));
console.log('\n=== transcript ===');
for (const m of db.listMessages(ws.id)) {
  const body = m.body.replace(/\s+/g, ' ').slice(0, 160);
  console.log(
    `${nameOf(m.fromId).padEnd(4)} -> ${nameOf(m.toId).padEnd(4)} [${m.act}/${m.status}] ${m.subject ? m.subject + ': ' : ''}${body}`,
  );
}
console.log('\n=== runs ===');
for (const a of agents) {
  for (const r of db.listRuns(a.id).reverse()) {
    console.log(
      `${a.name.padEnd(4)} ${r.status.padEnd(6)} in=${r.inputTokens} out=${r.outputTokens} cacheW=${r.cacheWriteTokens} cacheR=${r.cacheReadTokens} $${r.costUsd.toFixed(4)} session=${r.sessionId}`,
    );
  }
}
const toUser = db.listMessages(ws.id).filter((m) => m.toId === USER_ID && m.fromId !== USER_ID && m.act !== ACT.reply);
const ok = toUser.some((m) => m.act === ACT.inform && m.body.includes('391')) && toUser.some((m) => m.act === ACT.done);
console.log(`\nresult: ${ok ? 'PASS' : 'FAIL'}${Date.now() > deadline ? ' (timed out)' : ''}`);
process.exit(ok ? 0 : 1);
