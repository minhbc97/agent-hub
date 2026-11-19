import { CircleHelp, Monitor, Plus, Crown } from 'lucide-react';
import { PAGE, agentState, useHashRoute, useHub, waitingOnUser } from '@/lib/hub';
import { ACT, AGENT_STATUS, MESSAGE_STATUS, TASK_STATUS, type Agent, type TaskStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Composer } from '@/components/Composer';
import { AgentAvatar, TASK_TONE } from '@/components/shared';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const SUMMARY_STATUSES: TaskStatus[] = [
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.blocked,
  TASK_STATUS.done,
];

/** The team as a comic office: one desk per agent with a speech bubble saying what it is doing right now. */
export function HomePage({ openAgent, openNeeds }: { openAgent: (id: string) => void; openNeeds: () => void }) {
  const h = useHub();
  const [, navigate] = useHashRoute();
  const lead = h.agents.find((a) => a.isOrchestrator);
  const team = h.agents.filter((a) => !a.isOrchestrator);
  const needs = waitingOnUser(h.tasks, h.messages);
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="grid flex-1 grid-cols-[1fr_20rem] gap-5">
        <section className="relative flex flex-col rounded-xl border-2 border-foreground bg-card comic-shadow">
          <h1 className="absolute -top-3.5 left-5 rounded-md border-2 border-foreground bg-primary px-3 py-0.5 text-sm font-bold tracking-wider text-primary-foreground uppercase">
            {t('home.office')}
          </h1>
          <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] content-start gap-x-6 gap-y-10 rounded-xl halftone px-8 pt-12 pb-8">
            {lead && <Desk agent={lead} isLead onClick={() => openAgent(lead.id)} />}
            {team.map((a) => (
              <Desk key={a.id} agent={a} onClick={() => openAgent(a.id)} />
            ))}
            <Button
              variant="outline"
              onClick={() => navigate(`${PAGE.agents}/new`)}
              className="h-auto min-h-56 flex-col gap-2 self-end rounded-xl border-2 border-dashed bg-transparent text-muted-foreground"
            >
              <Plus />
              {t('agents.addAgent')}
            </Button>
          </div>
        </section>
        <aside className="grid content-start gap-5">
          <Button
            variant="ghost"
            onClick={openNeeds}
            className="h-auto -rotate-1 flex-col items-start gap-1 rounded-lg border-2 border-foreground bg-warning/20 p-4 text-left whitespace-normal comic-shadow-sm hover:bg-warning/30"
          >
            <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
              <CircleHelp />
              {t('inbox.needsYou')}
            </span>
            <span className="text-3xl font-bold tabular-nums">{needs.count}</span>
            <span className="text-xs text-muted-foreground">
              {needs.count ? t('home.needsHint') : t('inbox.noPendingItems')}
            </span>
          </Button>
          <div className="rounded-lg border-2 border-foreground bg-card p-4 comic-shadow-sm">
            <h2 className="mb-3 text-xs font-bold tracking-wider uppercase">{t('nav.tasks')}</h2>
            <div className="grid gap-2">
              {SUMMARY_STATUSES.map((status) => (
                <Button
                  key={status}
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(PAGE.tasks)}
                  className="justify-start gap-2 px-1.5 font-normal"
                >
                  <span className={cn('size-2 rounded-full', TASK_TONE[status].dot)} />
                  <span className="text-xs font-semibold tracking-wider">{t(`tasks.code.${status}`)}</span>
                  <span className="ml-auto tabular-nums">{h.tasks.filter((x) => x.status === status).length}</span>
                </Button>
              ))}
            </div>
          </div>
        </aside>
      </div>
      {lead && (
        <Composer
          key={lead.id}
          fixedRecipient={lead}
          className="px-0 pb-0"
          placeholder={t('home.composer', { name: lead.name })}
        />
      )}
    </div>
  );
}

function Desk({ agent, isLead = false, onClick }: { agent: Agent; isLead?: boolean; onClick: () => void }) {
  const line = useActivityLine(agent);
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-label={t('home.openChat', { name: agent.name })}
      className="group h-auto flex-col items-center gap-0 p-0 whitespace-normal hover:bg-transparent"
    >
      <span className="relative mb-3 max-w-full rounded-2xl border-2 border-foreground bg-background px-3.5 py-2 text-center text-sm font-medium comic-shadow-sm">
        <span className="line-clamp-2">{line}</span>
        <span className="absolute -bottom-1.5 left-1/2 size-2.5 -translate-x-1/2 rotate-45 border-r-2 border-b-2 border-foreground bg-background" />
      </span>
      <span className="transition-transform group-hover:-translate-y-1">
        <AgentAvatar agent={agent} size={isLead ? 104 : 88} ringClassName="ring-card" />
      </span>
      <span
        className={cn(
          '-mt-2 flex h-11 w-full items-center justify-center rounded-md border-2 border-foreground comic-shadow-sm',
          isLead ? 'bg-primary/40' : 'bg-chart-1/20',
        )}
      >
        <Monitor className="text-foreground/70" />
      </span>
      <span className="mt-2.5 flex items-center gap-1.5 rounded-md border-2 border-foreground bg-background px-2 py-0.5 text-xs font-bold tracking-wider uppercase">
        {isLead && <Crown className="size-3.5 text-primary" />}
        {agent.name}
      </span>
    </Button>
  );
}

/** What the speech bubble says: the live task first, then anything waiting, then idle. */
function useActivityLine(agent: Agent): string {
  const h = useHub();
  const state = agentState(agent, h.messages);
  const task = h.tasks.find((x) => x.assigneeId === agent.id && x.status === TASK_STATUS.doing);
  if (state === AGENT_STATUS.working) return task ? `${task.key} · ${task.title}` : t('home.working');
  if (state === AGENT_STATUS.paused) return t('home.paused');
  if (state === AGENT_STATUS.held) return t('home.held');
  const asksUser = h.messages.some(
    (m) => m.fromId === agent.id && m.act === ACT.needsHuman && m.status === MESSAGE_STATUS.held,
  );
  if (asksUser || h.tasks.some((x) => x.assigneeId === agent.id && x.status === TASK_STATUS.blocked))
    return t('home.waitingOnYou');
  if (agent.isOrchestrator) return t('home.leadIdle');
  return t('home.idle');
}
