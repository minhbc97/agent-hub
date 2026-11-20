import { useHub } from '@/lib/hub';
import { isSameAgentName, ROUTING, USER_ID, type Agent, type Message, type Workflow, type Workspace } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar, UserAvatar } from '@/components/shared';

interface Link {
  a: string;
  b: string;
  isAllowed: boolean;
  /** Messages per direction, keyed `${from}>${to}`. */
  sent: Map<string, number>;
  workflows: Set<string>;
}

interface Point {
  x: number;
  y: number;
}

const AVATAR_SIZE = 40;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Who may message whom, mirroring the server's routing rules in bus.ts `route()`. */
function allowedPairs(agents: Agent[], ws: Workspace): [string, string][] {
  const orchestrator = agents.find((a) => a.isOrchestrator);
  const pairs: [string, string][] = agents.map((a) => [USER_ID, a.id]);
  if (!orchestrator) {
    agents.forEach((a, i) => agents.slice(i + 1).forEach((b) => pairs.push([a.id, b.id])));
    return pairs;
  }
  for (const a of agents) if (a.id !== orchestrator.id) pairs.push([orchestrator.id, a.id]);
  if (ws.settings.routing !== ROUTING.mesh) return pairs;
  const idOf = (name: string) => agents.find((a) => isSameAgentName(a.name, name))?.id;
  for (const [x, y] of ws.settings.directPairs) {
    const [a, b] = [idOf(x), idOf(y)];
    if (a && b) pairs.push([a, b]);
  }
  return pairs;
}

function buildLinks(agents: Agent[], messages: Message[], workflows: Workflow[], ws: Workspace): Link[] {
  const nodeIds = new Set([USER_ID, ...agents.map((a) => a.id)]);
  const links = new Map<string, Link>();
  const linkFor = (a: string, b: string) => {
    const key = pairKey(a, b);
    let link = links.get(key);
    if (!link) {
      link = { a, b, isAllowed: false, sent: new Map(), workflows: new Set() };
      links.set(key, link);
    }
    return link;
  };
  for (const [a, b] of allowedPairs(agents, ws)) linkFor(a, b).isAllowed = true;
  for (const m of messages) {
    if (m.fromId === m.toId || !nodeIds.has(m.fromId) || !nodeIds.has(m.toId)) continue;
    const sent = linkFor(m.fromId, m.toId).sent;
    const direction = `${m.fromId}>${m.toId}`;
    sent.set(direction, (sent.get(direction) ?? 0) + 1);
  }
  for (const w of workflows) {
    const doers = w.steps.map((s) => s.agentId ?? USER_ID).filter((id) => nodeIds.has(id));
    doers.slice(1).forEach((to, i) => {
      const from = doers[i]!;
      if (from !== to) linkFor(from, to).workflows.add(w.name);
    });
  }
  return [...links.values()];
}

/** The user and the agents on a ring (percent coordinates), the orchestrator in the middle. */
function layout(agents: Agent[]): Map<string, Point> {
  const orchestrator = agents.find((a) => a.isOrchestrator);
  const ring = [USER_ID, ...agents.filter((a) => a !== orchestrator).map((a) => a.id)];
  const points = new Map<string, Point>();
  ring.forEach((id, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ring.length;
    points.set(id, { x: 50 + 38 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) });
  });
  if (orchestrator) points.set(orchestrator.id, { x: 50, y: 50 });
  return points;
}

const total = (link: Link) => [...link.sent.values()].reduce((sum, n) => sum + n, 0);

export function AgentMap() {
  const h = useHub();
  if (!h.ws || h.agents.length === 0) return null;
  const links = buildLinks(h.agents, h.messages, h.workflows, h.ws);
  const points = layout(h.agents);
  const nameOf = (id: string) => (id === USER_ID ? t('common.you') : (h.agentById(id)?.name ?? id));

  return (
    <Card className="mb-6 gap-0 p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
        <h2 className="font-medium">{t('agents.map.title')}</h2>
        <p className="text-xs text-muted-foreground">
          {h.ws.settings.routing === ROUTING.mesh ? t('agents.map.routingMesh') : t('agents.map.routingStar')}
        </p>
      </div>
      <div className="relative h-96">
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {links.map((link) => {
            const [p, q] = [points.get(link.a)!, points.get(link.b)!];
            const count = total(link);
            return (
              <line
                key={pairKey(link.a, link.b)}
                x1={p.x}
                y1={p.y}
                x2={q.x}
                y2={q.y}
                vectorEffect="non-scaling-stroke"
                strokeWidth={count ? Math.min(1.5 + count / 3, 6) : 1.5}
                strokeDasharray={!count && link.workflows.size ? '6 4' : undefined}
                className={cn(
                  count ? 'stroke-primary' : link.workflows.size ? 'stroke-primary/60' : 'stroke-border',
                  !link.isAllowed && count > 0 && 'stroke-warning',
                )}
              />
            );
          })}
        </svg>
        {links
          .filter((link) => total(link) || link.workflows.size)
          .map((link) => {
            const [p, q] = [points.get(link.a)!, points.get(link.b)!];
            const count = total(link);
            return (
              <Tooltip key={pairKey(link.a, link.b)}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="xs"
                    className="absolute -translate-1/2 rounded-full tabular-nums"
                    style={{ left: `${(p.x + q.x) / 2}%`, top: `${(p.y + q.y) / 2}%` }}
                    aria-label={t('agents.map.linkLabel', { a: nameOf(link.a), b: nameOf(link.b) })}
                  >
                    {count || t('agents.map.workflowShort')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="grid gap-0.5">
                  {[...link.sent].map(([direction, n]) => {
                    const [from, to] = direction.split('>') as [string, string];
                    return (
                      <span key={direction}>
                        {t('agents.map.sent', { from: nameOf(from), to: nameOf(to), count: n })}
                      </span>
                    );
                  })}
                  {[...link.workflows].map((name) => (
                    <span key={name}>{t('agents.map.handoff', { workflow: name })}</span>
                  ))}
                  {!link.isAllowed && <span>{t('agents.map.rerouted')}</span>}
                </TooltipContent>
              </Tooltip>
            );
          })}
        {[...points].map(([id, p]) => {
          const agent = h.agentById(id);
          const position = { left: `${p.x}%`, top: `${p.y}%` };
          const name = <span className="text-xs font-medium">{nameOf(id)}</span>;
          return agent ? (
            <Button
              key={id}
              variant="ghost"
              className="absolute h-auto -translate-1/2 flex-col gap-1 bg-card px-2 py-1.5"
              style={position}
              onClick={() => (location.hash = `/agents/${agent.id}`)}
            >
              <AgentAvatar agent={agent} size={AVATAR_SIZE} />
              {name}
            </Button>
          ) : (
            <div
              key={id}
              className="absolute flex -translate-1/2 flex-col items-center gap-1 rounded-md bg-card px-2 py-1.5"
              style={position}
            >
              <UserAvatar size={AVATAR_SIZE} />
              {name}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-primary" />
          {t('agents.map.legendMessages')}
        </span>
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed border-primary/60" />
          {t('agents.map.legendWorkflow')}
        </span>
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-border" />
          {t('agents.map.legendAllowed')}
        </span>
      </div>
    </Card>
  );
}
