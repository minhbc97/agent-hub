import { ENGINE, ROUTING } from '../shared/contracts.ts';
import type { Agent, Message, Task, Workspace } from './db.ts';

/** A brief file's text, or null when it is missing or over the inline budget and the agent must read it itself. */
export interface Brief {
  path: string;
  content: string | null;
}

/** What the hub already knows that a fresh session would otherwise have to rediscover. */
export interface CarriedContext {
  briefs: Brief[];
  openTasks: Task[];
}

/** First-turn briefing. Kept in English to save tokens. */
export function preamble(
  agent: Agent,
  team: Agent[],
  ws: Workspace,
  outbox: string,
  carried: CarriedContext = { briefs: [], openTasks: [] },
): string {
  const carriedLines = carriedContext(agent, carried);
  const orchestrator = team.find((a) => a.isOrchestrator);
  const others = team.filter((a) => a.id !== agent.id);
  const teamLines = others.map((a) => `- ${a.name}${a.isOrchestrator ? ' (orchestrator)' : ''}: ${firstLine(a.role)}`);

  if (agent.engine === ENGINE.openrouter) {
    return [
      `You are "${agent.name}", an AI agent on a team run by agent-hub (workspace "${ws.name}").`,
      agent.role ? `Your role:\n${agent.role}` : '',
      agent.goal ? `Your goal:\n${agent.goal}` : '',
      ...carriedLines,
      teamLines.length ? `Team:\n${teamLines.join('\n')}` : 'You are the only agent on this team.',
      '',
      'This provider only returns text. You cannot inspect or edit workspace files, run commands, use an outbox, or contact teammates.',
      'Return useful work directly in your response. For an assigned task, the hub records your response as the task result and advances the workflow.',
      'If an assigned task is blocked and needs a human answer, return exactly a JSON object with act "needs_human" and a short body, for example: {"act":"needs_human","body":"Which option should I use?"}.',
      'Never claim to have run commands, changed files, or contacted someone.',
      'Never print or store credentials, tokens or .env contents.',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  let routing: string;
  if (!orchestrator || ws.settings.routing === ROUTING.mesh) {
    const pairs = ws.settings.directPairs
      .filter(([x, y]) => x === agent.name || y === agent.name)
      .map(([x, y]) => (x === agent.name ? y : x));
    routing = orchestrator
      ? `Send to ${orchestrator.name} or "user"${pairs.length ? `, or directly to: ${pairs.join(', ')}` : ''}. Anything else is rerouted to ${orchestrator.name}.`
      : 'You may message any teammate or "user".';
  } else if (agent.isOrchestrator) {
    routing = 'You coordinate the team: you may message any teammate or "user".';
  } else {
    routing = `Send only to ${orchestrator.name} or "user". Messages to other teammates are rerouted to ${orchestrator.name}.`;
  }

  return [
    `You are "${agent.name}", an AI agent on a team run by agent-hub (workspace "${ws.name}").`,
    agent.role ? `Your role:\n${agent.role}` : '',
    agent.goal ? `Your goal:\n${agent.goal}` : '',
    ...carriedLines,
    teamLines.length ? `Team:\n${teamLines.join('\n')}` : 'You are the only agent on this team.',
    '',
    'How messaging works:',
    '- Your normal reply text is shown ONLY to the human user. Teammates never see it.',
    `- To message someone, write one JSON file per message into ${outbox} (any file name ending in .json):`,
    '  {"to":"<agent name or user>","act":"request|query|inform|done|needs_human","subject":"...","body":"..."}',
    '- act: request = ask for work, query = ask a question, inform = share a result, done = your task is finished,',
    '  needs_human = (to "user") you need a human decision or approval before continuing.',
    `- ${routing}`,
    '- Incoming messages start with a header like [From: name | act: ... | task: T-12 | subject: ...] (task only when the message belongs to one). Answer teammates via the outbox, not in your reply.',
    '- Do not message back just to say thanks or acknowledge. Send a message only when it moves the work forward.',
    '',
    "Tasks (shown on the human's board as keys like T-12):",
    '- A request whose header has a task key assigns you that task. Finish it with {"to":"user","act":"done","task":"T-12","body":"<result>"}.',
    '- Add "task":"T-12" to any message about an existing task. Use "task":"new" when you delegate a new piece of work to a teammate; the hub creates a task for it.',
    '  When a delegated task is done, the hub sends its result to the agent that delegated it, so do not send that result twice.',
    '- Ask the human with act needs_human (to "user") and the task key when you are blocked.',
    '  When the answer is a pick from a few choices, add "options":["choice A","choice B"] (2-6 short choices); the human can click one or still reply freely.',
    '',
    'Rules: never run git push, merge or rebase. Never print or store credentials, tokens or .env contents.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function formatIncoming(m: Message, fromName: string, taskKey?: string): string {
  const head = [
    `From: ${fromName}`,
    `act: ${m.act}`,
    taskKey && `task: ${taskKey}`,
    m.subject && `subject: ${m.subject}`,
    m.urgent && 'URGENT',
  ]
    .filter(Boolean)
    .join(' | ');
  return `[${head}]\n${m.body}`;
}

function carriedContext(agent: Agent, { briefs, openTasks }: CarriedContext): string[] {
  const toRead = briefs.filter((b) => b.content === null).map((b) => b.path);
  return [
    ...briefs.flatMap((b) =>
      b.content === null ? [] : [`Brief file ${b.path} (already loaded, do not read it again):\n${b.content.trim()}`],
    ),
    toRead.length ? `Read these brief files before working: ${toRead.join(', ')}` : '',
    agent.handoff
      ? `Handoff note from an earlier session (work finished since then may still be in it):\n${agent.handoff}`
      : '',
    openTasks.length
      ? `Your open tasks on the board:\n${openTasks.map((t) => `- ${t.key} [${t.status}] ${t.title}`).join('\n')}`
      : '',
  ];
}

const firstLine = (s: string) => s.split(/\r?\n/)[0]?.slice(0, 160) || 'teammate';
