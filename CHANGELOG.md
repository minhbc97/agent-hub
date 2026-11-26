# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-11-26

### Added

- Choose MCP servers per Claude and Codex agent, and add servers from the hub.
- Select MCP servers for regular Claude runs as well as lean runs.
- In-app guides with coachmarks, a getting-started list and tips for each agent.
- System notifications for important changes while the hub tab is out of view.
- An npm update notice with a copyable command to run the latest version.

### Changed

- Page, list and guide transitions are smoother.
- Claude agents can run `git push`, `git merge` or `git rebase` when that exact command is listed in Allowed commands.

## [0.3.0] - 2026-11-25

### Added

- Pause limit per workspace: hold messages once an engine's plan usage reaches a chosen percentage.

### Changed

- Lean agents with MCP servers load tool descriptions on demand, which cuts the fixed prompt of every model call.

### Fixed

- Reporting a task done no longer erases the agent's handoff note, nor its session while other work is under way.
- A session that has not seen a task gets its brief with the first message about it.
- The cost of a Claude run is what that turn cost, not the total of its session. Stored runs are corrected once.

## [0.2.0] - 2026-11-25

### Added

- Create and switch workspaces from the header. Names and worktree folders are unique, so workspaces stay apart.
- Each task's code follows it from agent to agent (worktree isolation), starts from the repo's current HEAD, and shows
  as a diff with a merge command in the task and its review card.
- Allowed commands per agent: shell commands Claude may run without asking, such as `npm test`.
- Stop an agent's running turn.
- CI on Windows, macOS and Linux.

### Fixed

- MCP config files, which can hold tokens, no longer stay in the data folder after a turn.
- On macOS and Linux, a timeout ends every process the CLI started, and quitting the hub ends running CLIs.
- Agents now see the task key of each incoming message, so delegated tasks no longer get stuck in DOING.
- An agent that delegates a task receives the result when the task is done.

## [0.1.1]

- The web UI defaults to English.
- Landing page on GitHub Pages.

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
