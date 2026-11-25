# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Allowed commands per agent: shell commands Claude may run without asking, such as `npm test`.
- Stop an agent's running turn.
- CI on Windows, macOS and Linux.

### Fixed

- MCP config files, which can hold tokens, no longer stay in the data folder after a turn.
- On macOS and Linux, a timeout ends every process the CLI started, and quitting the hub ends running CLIs.
- Agents now see the task key of each incoming message, so delegated tasks no longer get stuck in DOING.
- An agent that delegates a task receives the result when the task is done.

## [0.1.0]

First public release.

- Claude Code, Codex, Antigravity, OpenRouter and custom command engines, with session resume and per-turn token
  usage.
- Quota-aware queue with a fallback engine per agent, handoff notes between sessions, lean mode for Claude.
- Per-agent isolation: git worktree, shared repo or custom folder.
- JSON outbox messaging, star / mesh routing, loop guard, queue limits.
- Tasks board and list, workflows with review steps and cron schedules.
- Web UI in English and Vietnamese, light and dark themes.
- `npx @minhbc/agent-hub` entry point.
