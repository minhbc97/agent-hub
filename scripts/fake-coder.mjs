// Stand-in coding agent for tests: [write <file>] appends a line, [wander] leaves the task's commit, then reports done.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const agent = process.env.HUB_AGENT;
  const key = input.match(/act: request \| task: (T-\d+)/)?.[1];
  if (input.includes('[wander]') && key) {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
    const root = git('rev-list', '--max-parents=0', 'HEAD').trim();
    git('checkout', '-q', '--detach', root);
  }
  for (const [, file] of input.matchAll(/\[write (\S+)\]/g)) appendFileSync(file, `${agent}\n`);
  if (key)
    writeFileSync(
      join(process.env.HUB_OUTBOX, `${Date.now()}-done.json`),
      JSON.stringify({ to: 'user', act: 'done', task: key, body: `${agent} sees ${readdirSync('.').join(' ')}` }),
    );
  console.log(`${agent} handled ${key ?? 'a message'}`);
});
