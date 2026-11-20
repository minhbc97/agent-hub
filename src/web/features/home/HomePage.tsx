import { useCallback, useState } from 'react';
import { CircleHelp, Crown, MailOpen, Plus } from 'lucide-react';
import { PAGE, agentState, useHashRoute, useHub, waitingOnUser } from '@/lib/hub';
import { ACT, AGENT_STATUS, MESSAGE_STATUS, TASK_STATUS, USER_ID, type Agent, type TaskStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Composer } from '@/components/Composer';
import { AgentAvatar, TASK_TONE } from '@/components/shared';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { BookshelfArt, ChairArt, DeskArt, DoorwayArt, LoungeArt, MeetingTableArt, PlantArt } from './office-art';
import { MAIL_ANCHOR, MailFlights } from './MailFlights';

const BOARD_STATUSES: TaskStatus[] = [
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.blocked,
  TASK_STATUS.done,
];
const STICKIES_PER_COLUMN = 6;
const WINDOWS_ON_WALL = 6;
/** How long a desk shows the "got it" reaction after a letter lands. */
const RECEIVE_MS = 1800;

/** The team as an illustrated floor plan: the lead's own office, a meeting room with the task board and the team floor. */
export function HomePage({ openAgent, openNeeds }: { openAgent: (id: string) => void; openNeeds: () => void }) {
  const h = useHub();
  const [, navigate] = useHashRoute();
  const lead = h.agents.find((a) => a.isOrchestrator);
  const team = h.agents.filter((a) => !a.isOrchestrator);
  const needs = waitingOnUser(h.tasks, h.messages);
  // agent id -> token of its latest landing; a newer letter keeps the reaction alive past the older timer.
  const [arrivals, setArrivals] = useState<Record<string, number>>({});
  const receive = useCallback((agentId: string) => {
    const token = Date.now();
    setArrivals((current) => ({ ...current, [agentId]: token }));
    setTimeout(
      () =>
        setArrivals((current) => {
          if (current[agentId] !== token) return current;
          const rest = { ...current };
          delete rest[agentId];
          return rest;
        }),
      RECEIVE_MS,
    );
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="rounded-md border-2 border-foreground bg-primary px-3 py-0.5 text-sm font-bold tracking-wider text-primary-foreground uppercase comic-shadow-sm">
          {t('home.office')}
        </h1>
        <Button
          variant="ghost"
          onClick={openNeeds}
          className={cn(
            'h-auto gap-3 rounded-lg border-2 border-foreground px-4 py-2 comic-shadow-sm',
            needs.count ? '-rotate-1 bg-warning text-background hover:bg-warning/90' : 'bg-card',
          )}
        >
          <CircleHelp />
          <span className="text-xs font-bold tracking-wider uppercase">{t('inbox.needsYou')}</span>
          <span className="text-xl font-bold tabular-nums">{needs.count}</span>
          <span className={cn('text-xs', needs.count ? 'text-background/80' : 'text-muted-foreground')}>
            {needs.count ? t('home.needsHint') : t('inbox.noPendingItems')}
          </span>
        </Button>
      </div>
      {/* Keep the whole floor visible on desktop; smaller screens can scroll the plan. */}
      <div className="min-h-0 flex-1 overflow-hidden pr-1.5 pb-1.5 max-lg:overflow-y-auto [@media(max-height:760px)]:overflow-y-auto">
        <div className="relative grid h-full min-h-full grid-cols-[22rem_0.75rem_minmax(0,1fr)] grid-rows-[minmax(13rem,0.9fr)_0.75rem_minmax(14rem,1.1fr)] rounded-2xl border-4 border-office-ink bg-office-wall p-3 comic-shadow">
          <div aria-hidden className="absolute inset-x-16 top-0.5 flex justify-between">
            {Array.from({ length: WINDOWS_ON_WALL }, (_, i) => (
              <span key={i} className="h-2.5 w-20 rounded-full border-2 border-office-ink bg-office-screen" />
            ))}
          </div>
          <Room label={t('home.leadRoom')} floor="col-start-1 row-start-1 bg-office-carpet">
            <BookshelfArt className="absolute top-3 right-4 w-32" />
            <LoungeArt className="absolute bottom-3 left-3 w-24" />
            <PlantArt className="absolute right-3 bottom-3 size-14" />
            <div className="relative flex justify-center">
              {lead && (
                <Desk agent={lead} isLead isReceiving={!!arrivals[lead.id]} onClick={() => openAgent(lead.id)} />
              )}
            </div>
          </Room>
          <Room label={t('home.meetingRoom')} floor="col-start-3 row-start-1 bg-office-meeting floorboards">
            <TaskBoard onOpen={() => navigate(PAGE.tasks)} />
            <MeetingTableArt className="mx-auto mt-2 w-full max-w-64" />
          </Room>
          <Room label={t('home.teamFloor')} floor="col-span-3 col-start-1 row-start-3 bg-office-floor floor-tiles">
            <PlantArt className="absolute top-3 right-4 size-16" />
            <PlantArt className="absolute bottom-3 left-4 size-16" />
            <PlantArt className="absolute right-4 bottom-3 size-14" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-6 gap-y-4 px-14 pb-2">
              {team.map((a) => (
                <Desk key={a.id} agent={a} isReceiving={!!arrivals[a.id]} onClick={() => openAgent(a.id)} />
              ))}
              <Button
                variant="ghost"
                onClick={() => navigate(`${PAGE.agents}/new`)}
                className="h-32 flex-col gap-2 self-end rounded-xl border-2 border-dashed border-office-ink/50 bg-office-highlight/40 font-semibold text-office-ink hover:bg-office-highlight/70"
              >
                <Plus />
                {t('agents.addAgent')}
              </Button>
            </div>
          </Room>
          {/* Mirrored so the leaf opens into the lead office; the meeting room's task board sits against this wall. */}
          <DoorwayArt className="pointer-events-none z-20 col-start-2 row-start-1 size-16 -scale-x-100 self-center justify-self-center" />
          <DoorwayArt className="pointer-events-none z-20 col-span-3 col-start-1 row-start-2 size-16 rotate-90 self-center justify-self-center" />
        </div>
      </div>
      {lead && (
        <div {...{ [MAIL_ANCHOR]: USER_ID }}>
          <Composer
            key={lead.id}
            fixedRecipient={lead}
            className="px-0 pb-0"
            placeholder={t('home.composer', { name: lead.name })}
          />
        </div>
      )}
      <MailFlights messages={h.messages} onArrive={receive} />
    </div>
  );
}

/** One room on the plan: its own floor with a soft inner shadow from the walls, and a name sign. */
function Room({ label, floor, children }: { label: string; floor: string; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        'relative min-h-0 overflow-hidden rounded-xl border-2 border-office-ink p-4 pt-10 inset-shadow-sm inset-shadow-office-ink/40',
        floor,
      )}
    >
      <h2 className="absolute top-3 left-3 z-10 rounded-sm border-2 border-office-ink bg-office-highlight px-2 py-0.5 text-xs font-bold tracking-wider text-office-ink uppercase ink-shadow">
        {label}
      </h2>
      {children}
    </section>
  );
}

/** Whiteboard on the meeting-room wall: one column per status, a sticky note per task (capped) and the count. */
function TaskBoard({ onOpen }: { onOpen: () => void }) {
  const h = useHub();
  return (
    <Button
      variant="ghost"
      onClick={onOpen}
      aria-label={t('home.taskBoard')}
      className="relative grid h-auto w-full grid-cols-5 items-start gap-0 rounded-md border-2 border-office-ink bg-office-highlight p-3 text-office-ink ink-shadow hover:-translate-y-0.5 hover:bg-office-highlight"
    >
      {BOARD_STATUSES.map((status) => {
        const count = h.tasks.filter((x) => x.status === status).length;
        return (
          <span
            key={status}
            className="grid min-w-0 gap-2 border-r-2 border-office-ink/15 px-2 first:pl-0 last:border-r-0 last:pr-0"
          >
            <span className="flex items-center gap-1.5">
              <span className={cn('size-2 shrink-0 rounded-full', TASK_TONE[status].dot)} />
              <span className="truncate text-xs font-bold tracking-wider">{t(`tasks.code.${status}`)}</span>
            </span>
            <span className="flex min-h-12 flex-wrap content-start gap-1">
              {Array.from({ length: Math.min(count, STICKIES_PER_COLUMN) }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'size-4 rounded-xs border-2 border-office-ink',
                    TASK_TONE[status].dot,
                    i % 2 ? 'rotate-6' : '-rotate-3',
                  )}
                />
              ))}
            </span>
            <span className="text-left text-xl font-bold tabular-nums">{count}</span>
          </span>
        );
      })}
    </Button>
  );
}

/** How a desk looks: each state gets its own comic device so the room reads at a glance. */
type Mood = 'working' | 'waiting' | 'held' | 'paused' | 'idle';

const BUBBLE: Record<Mood, string> = {
  working: 'rounded-2xl bg-background',
  // A shout: hard corners, tilted, loud color.
  waiting: '-rotate-2 rounded-sm bg-warning font-bold text-background uppercase',
  held: 'rounded-2xl border-dashed bg-background text-muted-foreground',
  paused: 'rounded-2xl bg-muted text-muted-foreground',
  // A thought: fully round, with bubbles instead of a pointer.
  idle: 'rounded-full bg-background italic',
};

const TAIL_BG: Record<Mood, string> = {
  working: 'bg-background',
  waiting: 'bg-warning',
  held: 'bg-background',
  paused: 'bg-muted',
  idle: 'bg-background',
};

/** Comic sound-effect sticker per mood; moods without one show none. */
const SFX: Partial<Record<Mood, { key: string; className: string }>> = {
  working: {
    key: 'home.sfxWorking',
    className: 'rotate-6 bg-primary text-primary-foreground',
  },
  waiting: {
    key: 'home.sfxWaiting',
    className: '-rotate-6 bg-warning text-background',
  },
  paused: {
    key: 'home.sfxPaused',
    className: 'rotate-3 bg-muted text-muted-foreground',
  },
};

/** Staggered so the three dots bounce one after another, like someone typing. */
const TYPING_DOT_DELAYS = ['[animation-delay:0ms]', '[animation-delay:150ms]', '[animation-delay:300ms]'];

function Desk({
  agent,
  isLead = false,
  isReceiving = false,
  onClick,
}: {
  agent: Agent;
  isLead?: boolean;
  isReceiving?: boolean;
  onClick: () => void;
}) {
  const { line, mood } = useActivity(agent);
  const sfx = SFX[mood];
  const isWorking = mood === 'working';
  return (
    <Button
      variant="ghost"
      {...{ [MAIL_ANCHOR]: agent.id }}
      onClick={onClick}
      aria-label={t('home.openChat', { name: agent.name })}
      className={cn(
        'group relative h-auto flex-col items-center gap-0 p-0 whitespace-normal hover:bg-transparent',
        mood === 'paused' && 'opacity-60 grayscale',
      )}
    >
      <span
        className={cn(
          'relative z-10 mb-3 max-w-48 border-2 border-foreground px-3 py-1.5 text-center text-xs font-medium comic-shadow-sm',
          mood === 'idle' && 'mb-6',
          BUBBLE[mood],
        )}
      >
        <span className="line-clamp-2">{line}</span>
        {isWorking && (
          <span aria-hidden className="mt-1 flex justify-center gap-1">
            {TYPING_DOT_DELAYS.map((delay) => (
              <span key={delay} className={cn('size-1.5 rounded-full bg-current motion-safe:animate-bounce', delay)} />
            ))}
          </span>
        )}
        {mood === 'idle' ? (
          <>
            <span className="absolute -bottom-3 left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-foreground bg-background" />
            <span className="absolute -bottom-5 left-1/2 ml-2 size-1.5 rounded-full border-2 border-foreground bg-background" />
          </>
        ) : (
          <span
            className={cn(
              'absolute -bottom-1.5 left-1/2 size-2.5 -translate-x-1/2 rotate-45 border-r-2 border-b-2 border-foreground',
              mood === 'held' && 'border-dashed',
              TAIL_BG[mood],
            )}
          />
        )}
      </span>
      {/* The Button forces bare SVGs to size-4, so the art fills a wrapper that keeps its aspect ratio. */}
      <span className={cn('block', isLead ? 'aspect-50/21 w-56' : 'aspect-40/21 w-44')}>
        <DeskArt isLead={isLead} isScreenOn={isWorking} className="size-full" />
      </span>
      <span className={cn('relative -mt-4 grid place-items-center', isLead ? 'size-28' : 'size-24')}>
        <ChairArt className="absolute inset-0 size-full" />
        <span
          className={cn(
            'relative -mt-3 transition-transform group-hover:-translate-y-1',
            isReceiving && 'motion-safe:animate-hop',
          )}
        >
          <AgentAvatar agent={agent} size={isLead ? 64 : 54} ringClassName="ring-office-chair" />
          {isReceiving ? (
            <span className="absolute -top-3 -right-16 flex items-center gap-1 rounded-md border-2 border-foreground bg-office-highlight px-1.5 py-0.5 text-xs font-black tracking-wider whitespace-nowrap text-office-ink uppercase comic-shadow-sm motion-safe:animate-pop">
              <MailOpen className="size-3.5" />
              {t('home.sfxReceived')}
            </span>
          ) : (
            sfx && (
              <span
                className={cn(
                  'absolute -top-2 -right-14 rounded-md border-2 border-foreground px-1.5 py-0.5 text-xs font-black tracking-wider whitespace-nowrap uppercase comic-shadow-sm',
                  sfx.className,
                  isWorking && 'motion-safe:animate-wiggle',
                )}
              >
                {t(sfx.key)}
              </span>
            )
          )}
        </span>
      </span>
      <span className="-mt-1 flex items-center gap-1.5 rounded-sm border-2 border-office-ink bg-office-highlight px-2 py-0.5 text-xs font-bold tracking-wider text-office-ink uppercase ink-shadow">
        {isLead && <Crown className="size-3.5 text-chart-1" />}
        {agent.name}
      </span>
    </Button>
  );
}

/** What the speech bubble says and how it looks: the live task first, then anything waiting, then idle. */
function useActivity(agent: Agent): { line: string; mood: Mood } {
  const h = useHub();
  const state = agentState(agent, h.messages);
  const task = h.tasks.find((x) => x.assigneeId === agent.id && x.status === TASK_STATUS.doing);
  if (state === AGENT_STATUS.working)
    return {
      line: task ? `${task.key} · ${task.title}` : t('home.working'),
      mood: 'working',
    };
  if (state === AGENT_STATUS.paused) return { line: t('home.paused'), mood: 'paused' };
  if (state === AGENT_STATUS.held) return { line: t('home.held'), mood: 'held' };
  const asksUser = h.messages.some(
    (m) => m.fromId === agent.id && m.act === ACT.needsHuman && m.status === MESSAGE_STATUS.held,
  );
  if (asksUser || h.tasks.some((x) => x.assigneeId === agent.id && x.status === TASK_STATUS.blocked))
    return { line: t('home.waitingOnYou'), mood: 'waiting' };
  return {
    line: agent.isOrchestrator ? t('home.leadIdle') : t('home.idle'),
    mood: 'idle',
  };
}
