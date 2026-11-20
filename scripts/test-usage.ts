// Self-check for the plan-limit parsers (Claude Code get_usage answer, Codex rollout line).
import assert from 'node:assert/strict';
import { parseAntigravityLogs, parseClaudeUsageLine, parseCodexRolloutLine } from '../src/server/usage.ts';
import { QUOTA_RECHECK_MS, blockEngine, engineBlock, noteUsage, quotaRetryAt } from '../src/server/availability.ts';

const claude = parseClaudeUsageLine(
  JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: 'x',
      response: {
        subscription_type: 'pro',
        rate_limits: {
          five_hour: { utilization: 31, resets_at: '2026-11-20T06:40:00Z' },
          seven_day: { utilization: 70, resets_at: '2026-11-24T16:00:00Z' },
        },
      },
    },
  }),
);
assert.deepEqual(claude, {
  status: 'ok',
  plan: 'pro',
  windows: [
    { window: 'session', usedPercent: 31, resetsAt: '2026-11-20T06:40:00Z' },
    { window: 'week', usedPercent: 70, resetsAt: '2026-11-24T16:00:00Z' },
  ],
});
assert.equal(parseClaudeUsageLine('{"type":"system"}'), null);
assert.equal(parseClaudeUsageLine('not json'), null);

const now = Date.UTC(2026, 10, 20, 3, 0, 0);
const future = now / 1000 + 3600;
const past = now / 1000 - 60;
const codexLine = (primaryReset: number) =>
  JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        primary: { used_percent: 21, window_minutes: 300, resets_at: primaryReset },
        secondary: { used_percent: 58, window_minutes: 10080, resets_at: future },
        plan_type: 'plus',
      },
    },
  });
const codex = parseCodexRolloutLine(codexLine(future), now);
assert.equal(codex?.plan, 'plus');
assert.deepEqual(
  codex?.windows.map((w) => [w.window, w.usedPercent]),
  [
    ['session', 21],
    ['week', 58],
  ],
);
// A window whose reset time has passed is empty again.
assert.equal(parseCodexRolloutLine(codexLine(past), now)?.windows[0]?.usedPercent, 0);
assert.equal(parseCodexRolloutLine('{"type":"event_msg","payload":{}}', now), null);

// Antigravity: sign-in and quota refusals come from its CLI logs; the year is in the file name.
const agyName = 'cli-20261120_111558.log';
const signedIn =
  'I1120 11:15:59.635722     236 quota_manager.go:36] doRefreshQuota: skipped (not logged in)\n' +
  'I1120 11:16:00.629014     347 server_oauth.go:221] applyAuthResult: email=someone@example.com\n';
const refused =
  'E1120 11:16:17.259359     744 errorreport.go:285] RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 142h15m58s.\n';
const quotaResetsAt = new Date(2026, 10, 20, 11, 16, 17).getTime() + (142 * 3600 + 15 * 60 + 58) * 1000;
const exhausted = parseAntigravityLogs([{ name: agyName, text: signedIn + refused }], quotaResetsAt - 1000);
assert.equal(exhausted.status, 'ok');
assert.deepEqual(exhausted.windows, [
  { window: 'quota', usedPercent: 100, resetsAt: new Date(quotaResetsAt).toISOString() },
]);
assert.equal(
  parseAntigravityLogs([{ name: agyName, text: signedIn + refused }], quotaResetsAt + 1000).status,
  'noSource',
);
assert.equal(
  parseAntigravityLogs([{ name: agyName, text: 'I1120 11:15:59.6 x] doRefreshQuota: skipped (not logged in)\n' }], 0)
    .status,
  'notSignedIn',
);

// Quota errors: a known reset is used, an unknown one is retried later, other errors are not quota at all.
const t0 = Date.UTC(2026, 10, 20, 4, 0, 0);
assert.equal(
  quotaRetryAt('RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h3m4s.', t0),
  t0 + 7384_000,
);
assert.equal(quotaRetryAt('Claude AI usage limit reached|1795200000', t0), 1795200000_000);
assert.equal(quotaRetryAt("You've hit your limit", t0), t0 + QUOTA_RECHECK_MS);
assert.equal(quotaRetryAt('TypeError: cannot read properties of undefined', t0), undefined);
// A plan reading blocks an exhausted engine until its reset, and a healthy reading lifts an old block.
const resetsAt = new Date(t0 + 3600_000).toISOString();
noteUsage(
  {
    takenAt: '',
    engines: [
      {
        engine: 'antigravity',
        label: 'Antigravity',
        plan: null,
        status: 'ok',
        windows: [{ window: 'quota', usedPercent: 100, resetsAt }],
      },
    ],
  },
  t0,
);
assert.equal(engineBlock('antigravity', t0)?.until, t0 + 3600_000);
assert.equal(engineBlock('antigravity', t0 + 3600_001), null, 'expires at the reset');
blockEngine('codex', 'old failure', t0 + 3600_000);
noteUsage(
  {
    takenAt: '',
    engines: [
      {
        engine: 'codex',
        label: 'Codex',
        plan: null,
        status: 'ok',
        windows: [{ window: 'week', usedPercent: 40, resetsAt }],
      },
    ],
  },
  t0,
);
assert.equal(engineBlock('codex', t0), null);

console.log('usage test: PASS');
