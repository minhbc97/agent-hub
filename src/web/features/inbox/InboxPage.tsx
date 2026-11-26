import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Bot,
  Check,
  CircleHelp,
  List,
  Loader2,
  MessageSquareText,
  MessagesSquare,
  RotateCcw,
  Search,
  SquareTerminal,
  Send,
  Zap,
} from 'lucide-react';
import { PAGE, useHashRoute, useHub, waitingOnUser, waitingText, type OutgoingMessage } from '@/lib/hub';
import {
  ACT,
  AGENT_STATUS,
  api,
  DECISION,
  HUB_ID,
  MESSAGE_STATUS,
  TASK_STATUS,
  USER_ID,
  type Agent,
  type Message,
  type Task,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { i18n, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AgentAvatar, Avatar, PageHeading, SectionTitle, UserAvatar, label } from '@/components/shared';
import { TaskChanges } from '@/components/TaskChanges';
import { Markdown } from '@/components/Markdown';
import { MOTION } from '@/lib/motion';
import { Composer } from '@/components/Composer';
import { COACHMARK, Coachmark } from '@/components/Coachmark';
import { AgentTerminal } from '@/components/AgentTerminal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Only acts that change what the reader should do get a badge; plain chat stays unlabeled. */
const notableAct: Partial<Record<Message['act'], { key: string; variant: 'warning' | 'success' | 'secondary' }>> = {
  [ACT.needsHuman]: { key: 'inbox.actNeedsHuman', variant: 'warning' },
  [ACT.done]: { key: 'inbox.actDone', variant: 'success' },
  [ACT.query]: { key: 'inbox.actQuery', variant: 'secondary' },
};

const statusTranslation: Record<Message['status'], string> = {
  delivered: 'inbox.sent',
  running: 'inbox.running',
  held: 'inbox.onHold',
  queued: 'inbox.queued',
  failed: 'inbox.failed',
};

/** Inbox channels. Agent and task threads are written as `<prefix><id>`. */
export const INBOX_CHANNEL = { needs: 'needs', team: 'team' } as const;
export const AGENT_THREAD = 'agent:';
const TASK_THREAD = 'task:';

/** Messages from the same sender this close together share one header, like Slack. */
const GROUP_WINDOW_MS = 5 * 60_000;
/** Only follow new messages when the reader is already near the bottom. */
const STICK_TO_BOTTOM_PX = 120;

const locale = () => i18n.resolvedLanguage || 'en';
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toDateString();

function dayLabel(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return t('inbox.today');
  if (day.toDateString() === yesterday.toDateString()) return t('inbox.yesterday');
  return day.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

const TERMINAL_KEY = 'agent-hub.inbox-terminal';
const TERMINAL_CLOSED = 'closed';

/** Whether the terminal shows beside the chat; remembered on this device. */
function useTerminalPane(): [boolean, () => void] {
  const [isOpen, setOpen] = useState(() => {
    try {
      return localStorage.getItem(TERMINAL_KEY) !== TERMINAL_CLOSED;
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!isOpen);
    try {
      localStorage.setItem(TERMINAL_KEY, isOpen ? TERMINAL_CLOSED : 'open');
    } catch {
      /* storage unavailable */
    }
  };
  return [isOpen, toggle];
}

export function InboxPage({ filter, setFilter }: { filter: string; setFilter: (s: string) => void }) {
  const h = useHub();
  const [, navigate] = useHashRoute();
  const pending = waitingOnUser(h.tasks, h.messages);
  const selectedTask = filter.startsWith(TASK_THREAD)
    ? h.tasks.find((task) => task.id === filter.slice(TASK_THREAD.length))
    : undefined;
  const selectedAgent = filter.startsWith(AGENT_THREAD) ? h.agentById(filter.slice(AGENT_THREAD.length)) : undefined;
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const items = h.messages.filter(
    (m) =>
      (filter === INBOX_CHANNEL.team
        ? true
        : selectedAgent
          ? m.fromId === selectedAgent.id || m.toId === selectedAgent.id
          : selectedTask
            ? m.taskId === selectedTask.id
            : false) &&
      (!needle || `${m.subject} ${m.body}`.toLowerCase().includes(needle)),
  );

  const outgoing = h.outgoing.filter((o) =>
    filter === INBOX_CHANNEL.team
      ? true
      : selectedAgent
        ? o.toId === selectedAgent.id
        : selectedTask
          ? o.taskId === selectedTask.id
          : false,
  );

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const currentFilter = useRef(filter);
  useEffect(() => {
    const el = scroller.current;
    const didChangeFilter = currentFilter.current !== filter;
    currentFilter.current = filter;
    if (el && (atBottom.current || didChangeFilter)) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
    }
  }, [items.length, filter]);
  // Your own send always scrolls to it, wherever you were reading.
  useEffect(() => {
    const el = scroller.current;
    if (el && outgoing.length) {
      atBottom.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [outgoing.length]);
  const isNeeds = filter === INBOX_CHANNEL.needs;
  const [isTerminalOpen, toggleTerminal] = useTerminalPane();
  // A thread shows its own agent. The team channel follows whoever works until the reader picks one.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const isTeam = filter === INBOX_CHANNEL.team;
  const terminalAgent = isTeam
    ? (h.agentById(pickedId) ??
      h.agents.find((a) => a.status === AGENT_STATUS.working) ??
      h.agents.find((a) => a.isOrchestrator))
    : (selectedAgent ?? h.agentById(selectedTask?.assigneeId));
  return (
    <div className="flex h-full min-h-0">
      <ChannelList filter={filter} setFilter={setFilter} needsCount={pending.count} query={query} setQuery={setQuery} />
      <section className="flex min-w-0 flex-1 flex-col">
        <ThreadHeader
          filter={filter}
          needsCount={pending.count}
          agent={selectedAgent}
          task={selectedTask}
          onClose={() => setFilter(INBOX_CHANNEL.team)}
          terminal={terminalAgent && { isOpen: isTerminalOpen, onToggle: toggleTerminal }}
        />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
              }}
              className="min-h-0 flex-1 overflow-auto px-6 py-5"
            >
              {/* Keyed per channel so the old channel's rows unmount instead of playing exit animations over the new
                  one. Not on the scroller: the Composer beside it already uses this key. */}
              <div key={filter} className="flex min-h-full w-full flex-col">
                {isNeeds ? (
                  <NeedsList tasks={pending.tasks} questions={pending.messages} />
                ) : (
                  <>
                    {items.length === 0 && outgoing.length === 0 && (
                      <EmptyThread
                        kind={h.agents.length === 0 ? 'noAgents' : 'conversation'}
                        onAddAgent={() => navigate(`${PAGE.agents}/new`)}
                      />
                    )}
                    <AnimatePresence initial={false}>
                      {items.map((m, i) => (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, y: MOTION.list.offsetY }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -MOTION.list.offsetY }}
                          transition={MOTION.list}
                        >
                          {(i === 0 || dayKey(items[i - 1]!.createdAt) !== dayKey(m.createdAt)) && (
                            <DaySeparator iso={m.createdAt} />
                          )}
                          <MessageRow
                            message={m}
                            grouped={continuesGroup(items[i - 1], m)}
                            showRecipient={!selectedAgent}
                            isInTaskThread={!!selectedTask}
                            onOpenTask={(id) => setFilter(TASK_THREAD + id)}
                            onAnswer={() => setFilter(INBOX_CHANNEL.needs)}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <AnimatePresence initial={false}>
                      {outgoing.map((o) => (
                        <motion.div
                          key={o.key}
                          initial={{ opacity: 0, y: MOTION.list.offsetY }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -MOTION.list.offsetY }}
                          transition={MOTION.list}
                        >
                          <OutgoingRow message={o} showRecipient={!selectedAgent} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <WorkingLine agentId={selectedAgent?.id} />
                  </>
                )}
              </div>
            </div>
            {!isNeeds && h.agents.length > 0 && (
              <Composer
                key={filter}
                fixedRecipient={selectedAgent}
                taskRecipient={selectedTask ? h.agentById(selectedTask.assigneeId ?? '') : undefined}
                taskId={selectedTask?.id}
              />
            )}
          </div>
          {terminalAgent && isTerminalOpen && (
            <aside aria-label={t('agents.terminal.title')} className="w-1/2 min-w-0 shrink-0 border-l">
              <AgentTerminal
                key={terminalAgent.id}
                agent={terminalAgent}
                leading={isTeam && <TerminalAgentSelect agent={terminalAgent} onPick={setPickedId} />}
              />
            </aside>
          )}
        </div>
      </section>
    </div>
  );
}

function TerminalAgentSelect({ agent, onPick }: { agent: Agent; onPick: (id: string) => void }) {
  const h = useHub();
  return (
    <Select value={agent.id} onValueChange={onPick}>
      <SelectTrigger size="sm" aria-label={t('agents.terminal.chooseAgent')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {h.agents.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The inbox's own column: a different surface from the app sidebar so the two navigations read apart. */
function ChannelList({
  filter,
  setFilter,
  needsCount,
  query,
  setQuery,
}: {
  filter: string;
  setFilter: (channel: string) => void;
  needsCount: number;
  query: string;
  setQuery: (query: string) => void;
}) {
  const h = useHub();
  const lead = h.agents.find((a) => a.isOrchestrator);
  const others = h.agents.filter((a) => !a.isOrchestrator);
  const lastMessage = (agentId: string) => h.messages.findLast((m) => m.fromId === agentId || m.toId === agentId);
  const agentRow = (a: Agent) => {
    const last = lastMessage(a.id);
    return (
      <ChannelRow
        key={a.id}
        isActive={filter === AGENT_THREAD + a.id}
        onClick={() => setFilter(AGENT_THREAD + a.id)}
        icon={<AgentAvatar agent={a} size={32} ringClassName="ring-muted" />}
        title={a.name}
        badge={a.isOrchestrator ? <Badge variant="warning">{t('agents.orchestrator')}</Badge> : undefined}
        time={last ? timeOf(last.createdAt) : undefined}
        detail={a.status === AGENT_STATUS.working ? t('agents.working') : (last?.body ?? a.role)}
      />
    );
  };
  return (
    <nav
      aria-label={t('nav.inbox')}
      className="flex w-80 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/50 p-3 dark:bg-muted/30"
    >
      <InputGroup className="mb-3 bg-background">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('inbox.searchMessages')}
          aria-label={t('inbox.searchMessages')}
        />
      </InputGroup>
      <ChannelSection title={t('inbox.forYou')}>
        <ChannelRow
          isActive={filter === INBOX_CHANNEL.needs}
          onClick={() => setFilter(INBOX_CHANNEL.needs)}
          icon={<ChannelIcon tone="warning" icon={<CircleHelp />} />}
          title={t('inbox.needsYou')}
          badge={needsCount > 0 ? <Badge>{needsCount}</Badge> : undefined}
          detail={t('inbox.needsYouDetail')}
        />
        {lead && agentRow(lead)}
      </ChannelSection>
      <ChannelSection title={t('inbox.everyone')}>
        <ChannelRow
          isActive={filter === INBOX_CHANNEL.team}
          onClick={() => setFilter(INBOX_CHANNEL.team)}
          icon={<ChannelIcon icon={<MessagesSquare />} />}
          title={t('inbox.allMessages')}
          detail={t('inbox.allMessagesDetail')}
        />
      </ChannelSection>
      {others.length > 0 && <ChannelSection title={t('agents.title')}>{others.map(agentRow)}</ChannelSection>}
    </nav>
  );
}

function ChannelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 grid gap-0.5">
      <h2 className="px-2.5 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function ChannelIcon({ icon, tone }: { icon: React.ReactNode; tone?: 'warning' }) {
  return (
    <span
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4',
        tone === 'warning' ? 'bg-warning/15 text-warning' : 'bg-background text-muted-foreground',
      )}
    >
      {icon}
    </span>
  );
}

function ChannelRow({
  isActive,
  onClick,
  icon,
  title,
  badge,
  time,
  detail,
}: {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  time?: string;
  detail: string;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'h-auto w-full justify-start gap-3 px-2.5 py-2 text-left font-normal hover:bg-background/70',
        isActive && 'bg-primary/15 hover:bg-primary/20',
      )}
    >
      {icon}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{title}</span>
          {badge}
          {time && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{time}</span>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </Button>
  );
}

function ThreadHeader({
  filter,
  needsCount,
  agent,
  task,
  onClose,
  terminal,
}: {
  filter: string;
  needsCount: number;
  agent?: Agent;
  task?: Task;
  onClose: () => void;
  terminal?: { isOpen: boolean; onToggle: () => void };
}) {
  const [, navigate] = useHashRoute();
  const isNeeds = filter === INBOX_CHANNEL.needs;
  const icon = agent ? (
    <AgentAvatar agent={agent} size={36} />
  ) : (
    <ChannelIcon
      tone={isNeeds ? 'warning' : undefined}
      icon={task ? <List /> : isNeeds ? <CircleHelp /> : <MessagesSquare />}
    />
  );
  const title = agent
    ? agent.name
    : task
      ? `${task.key} · ${task.title}`
      : isNeeds
        ? t('inbox.needsYou')
        : t('inbox.allMessages');
  const subtitle = agent
    ? agent.role || t('agents.noRoleDescription')
    : task
      ? t(label[task.status])
      : isNeeds
        ? t('inbox.needsCount', { count: needsCount })
        : t('inbox.allMessagesDetail');
  return (
    <PageHeading
      variant="bar"
      title={title}
      subtitle={subtitle}
      media={icon}
      back={task && { label: t('nav.inbox'), onClick: onClose }}
      action={
        <>
          {terminal && (
            <Coachmark id={COACHMARK.terminal}>
              <Button
                variant={terminal.isOpen ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={terminal.isOpen}
                onClick={terminal.onToggle}
              >
                <SquareTerminal />
                {t('agents.terminal.title')}
              </Button>
            </Coachmark>
          )}
          {agent && (
            <Button variant="outline" size="sm" onClick={() => navigate(`${PAGE.agents}/${agent.id}`)}>
              <Bot />
              {t('inbox.viewAgent')}
            </Button>
          )}
        </>
      }
    />
  );
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground first:mt-0">
      <span className="h-px flex-1 bg-border" />
      {dayLabel(iso)}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function continuesGroup(prev: Message | undefined, m: Message): boolean {
  if (!prev || prev.fromId !== m.fromId || prev.toId !== m.toId || prev.taskId !== m.taskId) return false;
  if (dayKey(prev.createdAt) !== dayKey(m.createdAt)) return false;
  return Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
}

function useNameOf() {
  const h = useHub();
  return (id: string) =>
    id === USER_ID ? t('common.you') : id === HUB_ID ? t('common.hub') : (h.agentById(id)?.name ?? id);
}

function MessageRow({
  message: m,
  grouped,
  showRecipient,
  isInTaskThread,
  onOpenTask,
  onAnswer,
}: {
  message: Message;
  grouped: boolean;
  showRecipient: boolean;
  isInTaskThread: boolean;
  onOpenTask: (taskId: string) => void;
  onAnswer: () => void;
}) {
  const h = useHub();
  const nameOf = useNameOf();
  const sender = h.agentById(m.fromId);
  const task = m.taskId ? h.tasks.find((x) => x.id === m.taskId) : undefined;
  const act = notableAct[m.act];
  // A task question is answered through the task (blocked), a loose one stays held until answered.
  const isWaitingOnUser =
    m.act === ACT.needsHuman && (m.status === MESSAGE_STATUS.held || task?.status === TASK_STATUS.blocked);
  const isMine = m.fromId === USER_ID;
  return (
    <div className={cn('group flex gap-3 px-2 py-0.5', isMine && 'flex-row-reverse', !grouped && 'mt-3')}>
      {grouped ? (
        <span
          className={cn(
            'w-8 shrink-0 pt-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100',
            isMine ? 'text-left' : 'text-right',
          )}
        >
          {timeOf(m.createdAt)}
        </span>
      ) : (
        <span className="pt-0.5">{isMine ? <UserAvatar size={32} /> : <Avatar agent={sender} size={32} />}</span>
      )}
      <div className={cn('flex min-w-0 flex-1 flex-col', isMine ? 'items-end' : 'items-start')}>
        {!grouped && (
          <MessageHeader
            from={nameOf(m.fromId)}
            to={showRecipient ? nameOf(m.toId) : null}
            time={timeOf(m.createdAt)}
            isMine={isMine}
          />
        )}
        {(act || m.decision || m.urgent || m.status !== MESSAGE_STATUS.delivered) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {act && <Badge variant={act.variant}>{t(act.key)}</Badge>}
            {m.decision && (
              <Badge variant="outline">
                {t(m.decision === DECISION.approve ? 'inbox.approved' : 'inbox.returned')}
              </Badge>
            )}
            {m.urgent && (
              <Badge variant="destructive">
                <Zap />
                {t('inbox.urgent')}
              </Badge>
            )}
            {m.status !== MESSAGE_STATUS.delivered && !isWaitingOnUser && (
              <Badge variant={m.status === MESSAGE_STATUS.failed ? 'destructive' : 'outline'}>
                {t(statusTranslation[m.status])}
              </Badge>
            )}
          </div>
        )}
        {(m.subject || m.body) && (
          <Bubble isMine={isMine}>
            {m.subject && <div className="font-medium">{m.subject}</div>}
            {m.body && <Markdown text={m.body} />}
          </Bubble>
        )}
        {m.status === MESSAGE_STATUS.failed && h.agentById(m.toId) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-destructive">
            {m.holdReason && <span>{m.holdReason}</span>}
            <Button
              variant="outline"
              size="xs"
              onClick={() => h.attempt(() => api.retryMessage(m.id), t('inbox.retryQueued'))}
            >
              <RotateCcw />
              {t('inbox.retry')}
            </Button>
          </div>
        )}
        {((task && !isInTaskThread) || isWaitingOnUser) && (
          <div className="mt-2 flex max-w-full flex-wrap gap-2">
            {isWaitingOnUser && (
              <Button size="xs" onClick={onAnswer}>
                <CircleHelp />
                {t('inbox.answerInNeeds')}
              </Button>
            )}
            {task && !isInTaskThread && (
              <Button variant="outline" size="xs" className="max-w-full" onClick={() => onOpenTask(task.id)}>
                <List />
                <span className="truncate">
                  {task.key} · {task.title}
                </span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageHeader({ from, to, time, isMine }: { from: string; to: string | null; time: string; isMine: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-1.5 text-sm', isMine && 'justify-end')}>
      <span className="font-medium">{from}</span>
      {to && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ArrowRight className="size-3" />
          {to}
        </span>
      )}
      <span className="mx-1 text-xs text-muted-foreground">{time}</span>
    </div>
  );
}

/** Your messages sit right on the accent tint, everyone else's left on muted, like any chat. */
function Bubble({
  isMine,
  isPending = false,
  children,
}: {
  isMine: boolean;
  isPending?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-1 max-w-2xl rounded-2xl px-3.5 py-2 text-sm/6 wrap-anywhere',
        isMine ? 'rounded-tr-sm bg-primary/20 dark:bg-primary/15' : 'rounded-tl-sm bg-muted',
        isPending && 'opacity-70',
      )}
    >
      {children}
    </div>
  );
}

/** Your message right after Enter, before the server has it: same bubble, plus a spinner. */
function OutgoingRow({ message: o, showRecipient }: { message: OutgoingMessage; showRecipient: boolean }) {
  const nameOf = useNameOf();
  return (
    <div className="mt-3 flex flex-row-reverse gap-3 px-2 py-0.5">
      <span className="pt-0.5">
        <UserAvatar size={32} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-end">
        <MessageHeader
          from={nameOf(USER_ID)}
          to={showRecipient ? nameOf(o.toId) : null}
          time={timeOf(o.createdAt)}
          isMine
        />
        <Bubble isMine isPending>
          <Markdown text={o.body} />
        </Bubble>
        <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" />
          {t('inbox.sending')}
        </span>
      </div>
    </div>
  );
}

function WorkingLine({ agentId }: { agentId?: string }) {
  const h = useHub();
  const working = h.agents.filter((a) => a.status === AGENT_STATUS.working && (!agentId || a.id === agentId));
  if (!working.length) return null;
  return (
    <div className="mt-4 flex items-center gap-2 pl-13 text-xs text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        <span className="size-1 animate-pulse rounded-full bg-primary" />
        <span className="size-1 animate-pulse rounded-full bg-primary" />
        <span className="size-1 animate-pulse rounded-full bg-primary" />
      </span>
      {working.map((a) => a.name).join(', ')} {t('agents.working')}
    </div>
  );
}

function EmptyThread({ kind, onAddAgent }: { kind: 'needs' | 'noAgents' | 'conversation'; onAddAgent?: () => void }) {
  const Icon = kind === 'noAgents' ? Bot : kind === 'needs' ? Check : MessageSquareText;
  const title =
    kind === 'noAgents'
      ? t('agents.noAgentsYet')
      : kind === 'needs'
        ? t('inbox.noPendingItems')
        : t('inbox.noConversationsHereYet');
  const description =
    kind === 'noAgents'
      ? t('agents.addFirstAgentDescription')
      : kind === 'needs'
        ? t('inbox.noPendingItemsDescription')
        : t('inbox.startConversationHint');
  return (
    <div className="flex min-h-72 flex-1 flex-col items-center justify-center text-center">
      <div className="mb-5 grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">
        <Icon />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm/6 text-muted-foreground">{description}</p>
      {kind === 'noAgents' && onAddAgent && (
        <Button className="mt-6" onClick={onAddAgent}>
          {t('agents.addAgent')}
        </Button>
      )}
    </div>
  );
}

function NeedsList({ tasks, questions }: { tasks: Task[]; questions: Message[] }) {
  const reviews = tasks.filter((task) => task.status === TASK_STATUS.review);
  const blocked = tasks.filter((task) => task.status !== TASK_STATUS.review);
  if (!tasks.length && !questions.length) return <EmptyThread kind="needs" />;
  return (
    <div className="grid gap-8">
      {reviews.length > 0 && (
        <NeedsSection title={t('inbox.toReview')} count={reviews.length}>
          {reviews.map((task) => (
            <NeedTask key={task.id} task={task} />
          ))}
        </NeedsSection>
      )}
      {blocked.length + questions.length > 0 && (
        <NeedsSection title={t('inbox.questions')} count={blocked.length + questions.length}>
          {blocked.map((task) => (
            <NeedTask key={task.id} task={task} />
          ))}
          {questions.map((m) => (
            <NeedQuestion key={m.id} message={m} />
          ))}
        </NeedsSection>
      )}
    </div>
  );
}

function NeedsSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <SectionTitle className="mb-3 flex items-center gap-2">
        {title}
        <Badge variant="secondary">{count}</Badge>
      </SectionTitle>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function NeedTask({ task }: { task: Task }) {
  const h = useHub();
  const [note, setNote] = useState('');
  const assignee = h.agentById(task.assigneeId ?? '');
  // The task's question carries the agent's offered choices, if any.
  const question = h.messages.findLast((m) => m.taskId === task.id && m.act === ACT.needsHuman);
  const isReview = task.status === TASK_STATUS.review;
  const reason = waitingText(task, h.workflows) || t(label[task.status]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (await h.attempt(fn, ok)) setNote('');
  };
  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start gap-3">
        <Avatar agent={assignee} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{task.key}</Badge>
            <span className="font-medium">{task.title}</span>
          </div>
          <Markdown text={reason} className="mt-1 text-sm/6" />
          {task.result && (
            <Markdown text={task.result} className="mt-3 max-h-60 overflow-y-auto rounded-lg bg-muted p-3 text-sm/6" />
          )}
          {isReview && <TaskChanges task={task} className="mt-3" />}
          {!isReview && !!question?.options.length && (
            <AnswerOptions
              options={question.options}
              onPick={(option) => act(() => api.answer(task.id, option), t('inbox.replySent'))}
            />
          )}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isReview && note.trim()) void act(() => api.answer(task.id, note), t('inbox.replySent'));
            }}
          >
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={isReview ? t('inbox.noteOptional') : t('inbox.answerPlaceholder')}
              placeholder={
                isReview
                  ? t('inbox.noteOptional')
                  : question?.options.length
                    ? t('inbox.otherAnswer')
                    : t('inbox.answerPlaceholder')
              }
            />
            {isReview ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => act(() => api.decide(task.id, false, note), t('inbox.returned'))}
                >
                  {t('common.sendBack')}
                </Button>
                <Button type="button" onClick={() => act(() => api.decide(task.id, true, note), t('inbox.approved'))}>
                  <Check />
                  {t('common.approve')}
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={!note.trim()}>
                <Send />
                {t('common.send')}
              </Button>
            )}
          </form>
        </div>
      </div>
    </Card>
  );
}

/** A question an agent asked outside any task; answering it is a plain message back to that agent. */
function NeedQuestion({ message: m }: { message: Message }) {
  const h = useHub();
  const [answer, setAnswer] = useState('');
  const asker = h.agentById(m.fromId);
  const send = (body: string) =>
    h.ws && asker
      ? h.attempt(() => api.send(h.ws!.id, { to: asker.id, body, subject: m.subject }), t('inbox.replySent'))
      : Promise.resolve(undefined);
  const reply = async (e: FormEvent) => {
    e.preventDefault();
    if (!answer.trim()) return;
    if (await send(answer)) setAnswer('');
  };
  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start gap-3">
        <Avatar agent={asker} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="font-medium">{asker?.name}</span>
            <span className="text-xs text-muted-foreground">{timeOf(m.createdAt)}</span>
          </div>
          {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
          <Markdown text={m.body} className="mt-1 text-sm/6" />
          {m.options.length > 0 && <AnswerOptions options={m.options} onPick={send} />}
          <form className="mt-3 flex gap-2" onSubmit={reply}>
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              aria-label={t('inbox.answerPlaceholder')}
              placeholder={m.options.length ? t('inbox.otherAnswer') : t('inbox.answerPlaceholder')}
            />
            <Button type="submit" disabled={!answer.trim() || !asker}>
              <Send />
              {t('common.send')}
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The agent's offered choices as big lettered buttons: one click answers; the free-text box stays below. */
function AnswerOptions({ options, onPick }: { options: string[]; onPick: (option: string) => Promise<unknown> }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="mt-3 grid gap-2" role="group" aria-label={t('inbox.pickOption')}>
      {options.map((option, i) => (
        <Button
          key={option}
          variant="outline"
          disabled={picked !== null}
          onClick={async () => {
            setPicked(option);
            await onPick(option);
            setPicked(null);
          }}
          className="h-auto justify-start gap-3 py-2.5 text-left font-normal whitespace-normal hover:border-primary-ink hover:bg-primary/10"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold">
            {picked === option ? <Loader2 className="size-3.5 animate-spin" /> : OPTION_KEYS[i]}
          </span>
          {option}
        </Button>
      ))}
    </div>
  );
}
