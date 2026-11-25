// Stand-in agent for tests: reads the prompt on stdin, and if it names a task, reports it done via the outbox.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  // The preamble has an example key; the real one is in a request's header, or the last mentioned.
  const key = input.match(/act: request \| task: (T-\d+)/)?.[1] ?? [...input.matchAll(/"task":"(T-\d+)"/g)].at(-1)?.[1];
  const agent = process.env.HUB_AGENT;
  if (key && process.env.HUB_OUTBOX) {
    const msg = { to: 'user', act: 'done', task: key, body: `${agent} finished ${key}` };
    writeFileSync(join(process.env.HUB_OUTBOX, `${Date.now()}-done.json`), JSON.stringify(msg));
  }
  // "ping-pong with <name>": message that agent back and forth forever (exercises the loop guard).
  const partner = input.match(/ping-pong with (\S+)/)?.[1];
  if (partner && process.env.HUB_OUTBOX) {
    const msg = { to: partner, act: 'request', body: `ping-pong with ${agent}` };
    writeFileSync(join(process.env.HUB_OUTBOX, `${Date.now()}-ping.json`), JSON.stringify(msg));
  }
  console.log(`${agent} handled ${key ?? 'a message'}`);
});
