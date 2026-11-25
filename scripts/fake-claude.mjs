// Stand-in for `claude -p --input-format stream-json --output-format stream-json --replay-user-messages`: prints the
// events of a short turn, one at a time, and answers messages that arrive meanwhile at the next step, like the CLI.
// FAKE_CLAUDE_STEP_MS slows it down and FAKE_CLAUDE_LINES makes it longer, so the live view can be watched.
// FAKE_CLAUDE_COST: the session's cost so far.
// FAKE_CLAUDE_DEAF: ends the turn without reading what arrived during it.
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

const stepMs = Number(process.env.FAKE_CLAUDE_STEP_MS ?? 20);
const extraLines = Number(process.env.FAKE_CLAUDE_LINES ?? 0);
const isDeaf = !!process.env.FAKE_CLAUDE_DEAF;
const print = (event) => console.log(JSON.stringify(event));
const assistant = (block) => ({ type: 'assistant', message: { content: [block] } });
const toolResult = (content, is_error = false) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', content, is_error }] },
});
const result = (text) => ({
  type: 'result',
  result: text,
  session_id: 'fake-session',
  is_error: false,
  total_cost_usd: Number(process.env.FAKE_CLAUDE_COST ?? 0),
  usage: { input_tokens: 10, output_tokens: 1 },
});

const steps = [
  { type: 'system', subtype: 'init', model: 'fake-model', session_id: 'fake-session' },
  assistant({ type: 'thinking', thinking: 'Look at the config first.' }),
  assistant({ type: 'tool_use', name: 'Read', input: { file_path: 'src/config.ts' } }),
  toolResult([{ type: 'text', text: 'export const port = 4310;' }]),
  assistant({ type: 'tool_use', name: 'Bash', input: { command: 'cat .env' } }),
  toolResult('SMTP_HOST=mail.example.com\nDB_PASSWORD=not-a-real-password'),
  assistant({ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }),
  toolResult('1 test failed', true),
  ...Array.from({ length: extraLines }, (_, i) => assistant({ type: 'text', text: `Working on file ${i + 1}` })),
];

const inbox = [];
/** Show what arrived since the last step as read; returns it. */
function readInbox() {
  const messages = inbox.splice(0);
  for (const message of messages) print({ ...message, isReplay: true });
  return messages;
}
/** A live message is quoted in the answer, so a test can see it got there. */
const quote = (messages) => messages.map((m) => `Noted: ${m.message.content.split('\n').at(-1)}.`).join(' ');

let isStarted = false;
const input = createInterface({ input: process.stdin });
input.on('line', async (line) => {
  inbox.push(JSON.parse(line));
  if (isStarted) return;
  isStarted = true;
  readInbox();
  const heard = [];
  for (const step of steps) {
    print(step);
    await sleep(stepMs);
    if (!isDeaf) heard.push(...readInbox());
  }
  const answer = ['All done.', quote(heard)].filter(Boolean).join(' ');
  print(assistant({ type: 'text', text: answer }));
  if (isDeaf) process.exit(1);
  print(result(answer));
  print({ type: 'system', subtype: 'task_summary' });
  // Arrived after the answer was written: another round with its own result.
  for (await sleep(stepMs); inbox.length; await sleep(stepMs)) print(result(quote(readInbox())));
});
