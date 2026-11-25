import assert from 'node:assert/strict';
import type { Agent } from '../src/shared/contracts.ts';
import { ENGINE } from '../src/shared/contracts.ts';
import { antigravity } from '../src/server/engines/antigravity.ts';
import { claude } from '../src/server/engines/claude.ts';
import { mcpToolPrefix } from '../src/server/engines/claude-mcp.ts';
import { rolloutContext } from '../src/server/engines/codex.ts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openrouter,
  OPENROUTER_API_KEY_ENV,
  parseCompletion,
  parseTaskReply,
} from '../src/server/engines/openrouter.ts';

const agent: Agent = {
  id: 'agent-1',
  workspaceId: 'workspace-1',
  name: 'writer',
  role: '',
  goal: '',
  briefFiles: [],
  engine: ENGINE.openrouter,
  model: 'openai/gpt-5.2',
  command: '',
  extraArgs: '',
  isolation: 'shared',
  cwd: '',
  isOrchestrator: false,
  tint: '#f6bf1d',
  avatarSeed: 'writer',
  resetPolicy: 'never',
  resetValue: 0,
  handoff: '',
  isLean: false,
  mcpServers: [],
  allowedCommands: [],
  fallbackEngine: null,
  fallbackModel: '',
  activeEngine: null,
  sessionId: null,
  turnsInSession: 0,
  paused: false,
  status: 'idle',
};

if (!antigravity.formatInput || !openrouter.run) throw new Error('Expected provider execution hooks.');
const agyInput = antigravity.formatInput('hello');
assert.deepEqual(JSON.parse(agyInput.trim()), { event: 'user', message: { content: 'hello' } });
const agyResult = antigravity.parse(
  '{"event":"result","result":{"conversation_id":"conversation-1","status":"SUCCESS","response":"done","usage":{"input_tokens":20,"output_tokens":4,"thinking_tokens":2,"cache_read_tokens":8}}}',
  '',
  0,
);
assert.equal(agyResult.sessionId, 'conversation-1');
assert.deepEqual(agyResult.usage, {
  inputTokens: 20,
  outputTokens: 4,
  cacheWriteTokens: 0,
  cacheReadTokens: 8,
  costUsd: 0,
});

assert.deepEqual(
  parseCompletion({
    choices: [{ message: { content: 'hello' } }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 3,
      cost: 0.001,
      prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
    },
  }),
  {
    text: 'hello',
    sessionId: null,
    usage: { inputTokens: 10, outputTokens: 3, cacheWriteTokens: 1, cacheReadTokens: 2, costUsd: 0.001 },
    isError: false,
  },
);
assert.deepEqual(parseTaskReply('{"act":"needs_human","body":"Choose A or B."}'), {
  act: 'needs_human',
  body: 'Choose A or B.',
});
assert.deepEqual(parseTaskReply('A short result'), { act: 'done', body: 'A short result' });

const originalFetch = globalThis.fetch;
const originalApiKey = process.env[OPENROUTER_API_KEY_ENV];
process.env[OPENROUTER_API_KEY_ENV] = 'test-openrouter-key';
let shouldReject = false;
try {
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-openrouter-key');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: agent.model,
      messages: [{ role: 'user', content: 'test prompt' }],
    });
    return new Response(
      JSON.stringify(
        shouldReject
          ? { error: { message: 'Invalid key: test-openrouter-key' } }
          : { choices: [{ message: { content: 'API reply' } }] },
      ),
      {
        status: shouldReject ? 401 : 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };
  const result = await openrouter.run(agent, 'test prompt', AbortSignal.timeout(1000));
  assert.equal(result.text, 'API reply');
  assert.equal(result.isError, false);

  shouldReject = true;
  const rejected = await openrouter.run(agent, 'test prompt', AbortSignal.timeout(1000));
  assert.equal(rejected.isError, true);
  assert.ok(!rejected.text.includes('test-openrouter-key'));
} finally {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env[OPENROUTER_API_KEY_ENV];
  else process.env[OPENROUTER_API_KEY_ENV] = originalApiKey;
}

// Claude sums usage over the turn's model calls; the session's context is the last call's prompt.
const claudeResult = claude.parse(
  JSON.stringify({
    type: 'result',
    result: 'ok',
    session_id: 's-1',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 100,
      iterations: [{ input_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 40 }],
    },
  }),
  '',
  0,
);
assert.equal(claudeResult.contextTokens, 542);
// The result is found between other events; a stream cut before it is a failure, not an empty answer.
const streamed = ['{"type":"assistant","message":{}}', '{"type":"result","result":"done"}', '{"type":"system"}'];
assert.equal(claude.parse(streamed.join('\n'), '', 0).text, 'done');
assert.equal(claude.parse(streamed[0]!, 'killed', null).isError, true);
// A message that arrived as the turn ended is answered in a second round: tokens add up, the cost is already a total.
const rounds = claude.parse(
  [
    '{"type":"result","result":"one","total_cost_usd":1,"usage":{"output_tokens":5}}',
    '{"type":"result","result":"two","total_cost_usd":3,"usage":{"output_tokens":2}}',
  ].join('\n'),
  '',
  0,
);
assert.deepEqual([rounds.text, rounds.usage.outputTokens, rounds.usage.costUsd], ['one\n\ntwo', 7, 3]);
assert.equal(claude.parse('{"type":"result","result":"ok","usage":{}}', '', 0).contextTokens, undefined);
assert.ok(
  claude.command({ ...agent, isLean: true }, { resumeId: null, extraDirs: [] }).includes('--strict-mcp-config'),
);
// Lean agents get ToolSearch only with MCP servers, so their tool descriptions load on demand.
const leanCommand = (mcpServers: string[]) =>
  claude.command({ ...agent, isLean: true, mcpServers }, { resumeId: null, extraDirs: [] });
assert.ok(!leanCommand([]).includes('ToolSearch'));
assert.ok(leanCommand(['jira']).includes(',ToolSearch --mcp-config'));
claude.afterTurn!(agent);
assert.equal(mcpToolPrefix('plugin:design:google calendar'), 'mcp__plugin_design_google_calendar');

// Codex: the context is the last model call's input from its rollout log, found by thread id.
const sessionsDir = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
mkdirSync(join(sessionsDir, '2026', '11', '20'), { recursive: true });
writeFileSync(
  join(sessionsDir, '2026', '11', '20', 'rollout-2026-11-20T10-00-00-thread-9.jsonl'),
  [
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000 } } } },
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 4200 } } } },
    { type: 'event_msg', payload: { type: 'agent_message' } },
  ]
    .map((e) => JSON.stringify(e))
    .join('\r\n'),
);
assert.equal(rolloutContext('thread-9', sessionsDir), 4200);
assert.equal(rolloutContext('thread-missing', sessionsDir), undefined);
rmSync(sessionsDir, { recursive: true, force: true });

console.log('Provider engine checks passed.');
