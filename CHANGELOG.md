# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
