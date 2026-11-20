# CLI probe results (2026-11-19)

Checked by running each CLI headless with a one-line prompt on this machine (Windows 11, Node 24.5.0).

## Claude Code 2.1.328

- `echo <prompt> | claude -p --output-format json [--model m] [--resume <id>]` works, prompt on stdin.
- Output: a single JSON object. Fields used: `result`, `session_id`, `is_error`, `subtype`, `total_cost_usd`,
  `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`,
  `usage.cache_read_input_tokens`. Usage is **per turn**.
- `--resume <id>` keeps the same `session_id`.
- Headless turns cannot answer permission prompts. Agents need e.g. `--permission-mode acceptEdits` in
  extra args to write files; the runner adds `--add-dir <outbox>` so the outbox is inside the allowed dirs.

### Claude limits without reading credentials

Stream-json mode accepts an SDK control request that returns plan usage. Claude Code reads its own
login; agent-hub never touches `~/.claude/.credentials.json`.

```text
printf '%s\n' '{"type":"control_request","request_id":"u1","request":{"subtype":"get_usage","skip_behaviors":true}}' \
  | claude -p --input-format stream-json --output-format stream-json --verbose
```

The `control_response` line has `response.response.rate_limits.five_hour` and `.seven_day`, each with
`utilization` (percent used) and `resets_at` (ISO time), plus `subscription_type` and a `limits[]` list.
No model call is made, so reading limits costs no tokens.

The statusline input also carries `rate_limits.five_hour.used_percentage` / `.resets_at` (epoch seconds)
and `seven_day`, but only in interactive sessions, so it is not needed.

## Codex 0.164.0

- `echo <prompt> | codex exec --json --skip-git-repo-check -` works. Resume:
  `codex exec --json --skip-git-repo-check resume <thread_id> -`.
- `--skip-git-repo-check` is required when cwd is not a git repo.
- JSONL events: `thread.started.thread_id`, `item.completed` with `item.type == "agent_message"` and
  `item.text`, `turn.completed.usage.{input_tokens, cached_input_tokens, cache_write_input_tokens,
  output_tokens, reasoning_output_tokens}`.
- **`turn.completed.usage` is cumulative for the thread on resume** (turn 2 reported 41644 input =
  turn 1 + turn 2). Per-turn tokens = difference from the previous turn of the same thread, or
  `last_token_usage` from the rollout file.
- Limits: `~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread_id>.jsonl`, event `event_msg` with
  `payload.type == "token_count"`: `payload.rate_limits.primary` (window_minutes 300) and `.secondary`
  (10080), each `{used_percent, window_minutes, resets_at}` with `resets_at` in epoch seconds. Also
  `plan_type`, `credits`, and `payload.info.{total_token_usage, last_token_usage, model_context_window}`.

## Antigravity (agy) 1.5.12

- `agy -p='<prompt>' --output-format json` works (prompt must be attached to `-p=`).
- Output: one JSON object `{conversation_id, status: "SUCCESS"|"ERROR", response, error?,
  duration_seconds, num_turns, finished_reason?, usage: {input_tokens, output_tokens, thinking_tokens,
  cache_read_tokens, total_tokens}}`.
- Resume flag is `--conversation <id>`. Could not confirm the resumed answer: the account hit its quota.
- On quota, stderr has `AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429) ...","error_code":429,...}`
  and the message `Individual quota reached ... Resets in 163h31m7s.` That gives a real reset time when the
  quota is hit; there is still no usage percentage before that.
- Other useful flags: `--model`, `--effort`, `--mode accept-edits|auto|plan`, `--dangerously-skip-permissions`,
  `--print-timeout`, `--input-format stream-json` (needs `--output-format stream-json`).
- Prompt via `-p=` is limited by the Windows command-line length (about 8 KB through cmd.exe), so the
  adapter sends the prompt with `--input-format stream-json` on stdin instead.
