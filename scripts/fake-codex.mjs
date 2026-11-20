// Stand-in for `codex exec --json`: JSONL events whose usage is the running total of the thread, like real Codex.
// A prompt containing "linger" keeps the process alive after the turn, like Codex waiting on a hung shell command.
const resumed = process.argv.includes('resume');
const usage = resumed
  ? { input_tokens: 300, cached_input_tokens: 100, output_tokens: 30 }
  : { input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 };
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  // FAKE_CODEX_QUOTA set: answer like an exhausted plan, so the hub's quota hold can be tested.
  if (process.env.FAKE_CODEX_QUOTA) {
    console.log(
      JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit. Resets in 1h0m0s" } }),
    );
    process.exit(1);
  }
  for (const event of [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', item: { type: 'agent_message', text: resumed ? 'second' : 'first' } },
    { type: 'turn.completed', usage },
  ])
    console.log(JSON.stringify(event));
  if (input.includes('linger')) setInterval(() => {}, 1000);
});
