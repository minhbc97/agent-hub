# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who want to run an open-source agent hub on their own machine to coordinate multiple CLI agents. The intended audience is broader than the founder or one project. The specific level of technical experience to support is undecided.

## Product Purpose

Agent-hub helps people coordinate multi-agent workflows through a local web interface. Its primary long-term priority is orchestrating work across agents and humans, including ordered tasks, handoffs, and review steps.

## Positioning

A self-hosted hub connects installed agent CLIs through turn-based runs and file-based outboxes. Users configure agents, routing, tasks, and workflows through the UI.

## Operating Context

Users start the hub with `npx @minhbc97/agent-hub` (or clone the repository to develop), create a workspace for a repository, and configure agents. A workspace contains its own agents, tasks, workflows, messages, and settings. Supported engines are Claude Code, Codex, Antigravity, OpenRouter (API, text only), and a custom command, with an optional fallback engine per agent. Runs can use separate Git worktrees, a shared repository, or a custom working directory.

## Capabilities and Constraints

- The web app provides an inbox, task board and list, workflow editor, agent configuration and run history, and workspace settings.
- Workflows can assign steps to agents or a person, require human review, return to an earlier step, and run manually or on a cron schedule.
- Agent messages pass through validated JSON files in per-agent outboxes. Ordinary CLI output is visible to the user and is not automatically forwarded to another agent.
- The server binds to localhost and stores data locally in SQLite. It uses the installed CLI's existing sign-in; the hub does not read its credentials.
- The UI supports Vietnamese and English, with light and dark themes.
- Work hours, notifications, and configuration import/export are planned and not built.
- Published as open source under the MIT license and distributed on npm. No support policy beyond GitHub issues.

## Evidence on Hand

- `README.md` describes setup, implemented behavior, and known gaps.
- `docs/user-guide.md` describes the current user workflows and terminology.
- `docs/architecture.md` and `docs/engines.md` describe how the hub works.
- The repository includes runnable web and server code and a workflow test script. There is no user research, adoption data, or external validation recorded in these sources.

## Product Principles

1. Make multi-agent workflows understandable and controllable by people.
2. Keep workspace, agent, and workflow configuration useful across different projects.
3. Make handoffs, human review, failures, and held work visible in the UI.
4. Let people run the hub with their own installed CLIs and local data.
