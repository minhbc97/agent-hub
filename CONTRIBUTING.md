# Contributing

Thanks for helping. Issues and pull requests are welcome in English or Vietnamese.

## Setup

Requires Node.js 24+.

```bash
git clone https://github.com/minhbc97/agent-hub.git
cd agent-hub
npm install
npm run dev
```

`npm run dev` starts the server with Vite middleware (hot reload) on <http://127.0.0.1:4310>, with data in `data/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server + Vite middleware, hot reload |
| `npm run build` then `npm start` | Production build, serves `dist/` |
| `npm test` | Workflow, outbox, loop guard and usage tests with fake agents (no tokens spent) |
| `npm run check` | `format` → `lint` → `typecheck`; must be clean before a PR |
| `npm run demo:pm-be` | Real pm → be → pm demo with Claude (`haiku`, spends tokens), data in `data/demo` |

## Project layout

```
bin/            npx entry point
src/server/     Node server (node:http, node:sqlite), no framework
  api/ routes/  REST API under /api (http/ holds request helpers)
  bus.ts        queue, outbox, star/mesh routing, loop guard
  runner.ts     runs one CLI turn (stdin prompt, timeout, process-tree kill)
  engines/      adapters per CLI + model catalog
  workflow.ts   workflow / task engine, cron schedules
  db.ts         SQLite schema + migrations
src/web/        React + Vite + Tailwind 4 + shadcn/ui
  features/     one folder per page
  locales/      vi.json, en.json
src/shared/     types and constants shared by server and web
scripts/        tests with fake agents, demo
docs/           user guide, architecture, API, engines
```

## Rules

Code rules live in [AGENTS.md](AGENTS.md), which coding agents read too. The main ones:

- Keep changes small. No new dependency without discussing it in an issue first.
- UI strings go through i18n, in both `vi.json` and `en.json`. Colors and spacing use design tokens, not hex values.
- Use shadcn/ui components and `lucide-react` icons instead of raw HTML controls.
- Schema changes need a migration in `db.ts`.
- Run `npm run check` (0 errors, 0 warnings) and `npm test` if you touched the server.
- Code, comments and commit messages in English.

## Reporting security issues

The hub runs commands on the user's machine. If you find a way to bypass the localhost-only server, the origin checks
or the git push block, please open a
[private security advisory](https://github.com/minhbc97/agent-hub/security/advisories/new) instead of a public issue.
