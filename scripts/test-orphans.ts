// Self-check on Windows: a hard-stopped hub leaves the CLI under its shell running; endOrphanedCLIs ends it and leaves
// a process whose parent pid matches but started outside the window alone.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
if (process.platform !== 'win32') {
  console.log('orphan check: skipped (Windows only)');
  process.exit(0);
}
const dataDir = resolve('data/test-orphans');
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
process.env.HUB_DATA = dataDir;
const alive = (pid: number) =>
  execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' }).includes(String(pid));
const childOf = (pid: number) =>
  Number(
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`],
      { encoding: 'utf8' },
    ).trim(),
  );
const fakeHub = () => {
  const hub = spawn(process.execPath, [
    '-e',
    `const c=require('child_process').spawn('node -e "setTimeout(()=>{},60000)"',{shell:true});console.log(c.pid, Date.now());setTimeout(()=>{},60000)`,
  ]);
  return new Promise<{ hub: typeof hub; shell: number; at: number }>((r) =>
    hub.stdout.once('data', (d) => {
      const [shell, at] = String(d).trim().split(' ').map(Number);
      r({ hub, shell: shell!, at: at! });
    }),
  );
};
const a = await fakeHub();
const b = await fakeHub();
await new Promise((r) => setTimeout(r, 1500));
const cliA = childOf(a.shell);
const cliB = childOf(b.shell);
for (const h of [a, b]) execFileSync('taskkill', ['/pid', String(h.hub.pid), '/F']);
await new Promise((r) => setTimeout(r, 1000));
assert.ok(alive(cliA) && alive(cliB), 'CLIs outlive a hard-stopped hub (the bug)');
// b is recorded as started long before its CLI appeared, like a reused pid.
writeFileSync(
  join(dataDir, 'agent-pids.json'),
  JSON.stringify([
    [a.shell, a.at],
    [b.shell, b.at - 10 * 60_000],
  ]),
);
const { endOrphanedCLIs } = await import('../src/server/runner.ts');
endOrphanedCLIs();
await new Promise((r) => setTimeout(r, 1000));
assert.ok(!alive(cliA), 'the orphaned CLI is ended');
assert.ok(alive(cliB), 'a child outside the start window is left alone');
execFileSync('taskkill', ['/pid', String(cliB), '/F']);
console.log('orphan check: PASS');
process.exit(0);
