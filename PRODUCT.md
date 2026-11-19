# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who want to clone and run an open-source agent hub to coordinate multiple CLI agents. The intended audience is broader than the founder or one project. The specific level of technical experience to support is undecided.

## Product Purpose

Agent-hub helps people coordinate multi-agent workflows through a local web interface. Its primary long-term priority is orchestrating work across agents and humans, including ordered tasks, handoffs, and review steps.

## Positioning

A self-hosted hub connects installed agent CLIs through turn-based runs and file-based outboxes. Users configure agents, routing, tasks, and workflows through the UI. BookLink was the context for the initial idea, not the product's fixed use case or audience.

## Operating Context

Users clone the repository, install dependencies, run a local server, create a workspace for a repository, and configure agents. A workspace contains its own agents, tasks, workflows, messages, and settings. Supported agent engines currently include Claude Code, Codex, and a custom command. Runs can use separate Git worktrees, a shared repository, or a custom working directory.

## Capabilities and Constraints

- The web app provides an inbox, task board and list, workflow editor, agent configuration and run history, and workspace settings.
- Workflows can assign steps to agents or a person, require human review, return to an earlier step, and run manually or on a cron schedule.
- Agent messages pass through validated JSON files in per-agent outboxes. Ordinary CLI output is visible to the user and is not automatically forwarded to another agent.
- The server binds to localhost and stores data locally in SQLite. It uses the installed CLI's existing sign-in; the hub does not read its credentials.
- The UI supports Vietnamese and English, with light and dark themes.
- Antigravity integration, engine usage limits, work hours, notifications, configuration import/export, and several agent form fields remain planned or incomplete. The original `PLAN.md` is an early idea, so its unimplemented items are not fixed product commitments.
- Open-source publication is intended. A license, distribution process, and support policy have not been established in the repository evidence reviewed for this record.

## Evidence on Hand

- `README.md` describes setup, implemented behavior, and known gaps.
- `docs/user-guide.md` describes the current user workflows and terminology.
- `PLAN.md` records the initial concept, and `HANDOFF.md` records implementation history. Neither should override the user's broader open-source audience.
- The repository includes runnable web and server code and a workflow test script. There is no user research, adoption data, or external validation recorded in these sources.

## Product Principles

1. Make multi-agent workflows understandable and controllable by people.
2. Keep workspace, agent, and workflow configuration useful across different projects.
3. Make handoffs, human review, failures, and held work visible in the UI.
4. Let people run the hub with their own installed CLIs and local data.
