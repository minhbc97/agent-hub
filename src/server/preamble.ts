import { ROUTING } from '../shared/contracts.ts';
import type { Agent, Message, Workspace } from './db.ts';

/** First-turn briefing. Kept in English to save tokens. */
export function preamble(agent: Agent, team: Agent[], ws: Workspace, outbox: string): string {
  const orchestrator = team.find((a) => a.isOrchestrator);
  const others = team.filter((a) => a.id !== agent.id);
  const teamLines = others.map((a) => `- ${a.name}${a.isOrchestrator ? ' (orchestrator)' : ''}: ${firstLine(a.role)}`);

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
    agent.briefFiles.length ? `Read these brief files before working: ${agent.briefFiles.join(', ')}` : '',
    teamLines.length ? `Team:\n${teamLines.join('\n')}` : 'You are the only agent on this team.',
    '',
    'How messaging works:',
    '- Your normal reply text is shown ONLY to the human user. Teammates never see it.',
    `- To message someone, write one JSON file per message into ${outbox} (any file name ending in .json):`,
    '  {"to":"<agent name or user>","act":"request|query|inform|done|needs_human","subject":"...","body":"..."}',
    '- act: request = ask for work, query = ask a question, inform = share a result, done = your task is finished,',
    '  needs_human = (to "user") you need a human decision or approval before continuing.',
    `- ${routing}`,
    '- Incoming messages start with a header like [From: name | act: ... | subject: ...]. Answer teammates via the outbox, not in your reply.',
    '- Do not message back just to say thanks or acknowledge. Send a message only when it moves the work forward.',
    '',
    "Tasks (shown on the human's board as keys like T-12):",
    '- Messages from "hub" assign you a task or a workflow step. Finish it with {"to":"user","act":"done","task":"T-12","body":"<result>"}.',
    '- Add "task":"T-12" to any message about an existing task. Use "task":"new" when you delegate a new piece of work to a teammate; the hub creates a task for it.',
    '- Ask the human with act needs_human (to "user") and the task key when you are blocked.',
    '',
    'Rules: never run git push, merge or rebase. Never print or store credentials, tokens or .env contents.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function formatIncoming(m: Message, fromName: string): string {
  const head = [`From: ${fromName}`, `act: ${m.act}`, m.subject && `subject: ${m.subject}`, m.urgent && 'URGENT']
    .filter(Boolean)
    .join(' | ');
  return `[${head}]\n${m.body}`;
}

const firstLine = (s: string) => s.split(/\r?\n/)[0]?.slice(0, 160) || 'teammate';
