import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleHelp,
  List,
  MessageSquareText,
  MessagesSquare,
  RotateCcw,
  Search,
  Send,
  Zap,
} from 'lucide-react';
import { PAGE, useHashRoute, useHub, waitingOnUser, waitingText } from '@/lib/hub';
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
import { AgentAvatar, Avatar, label } from '@/components/shared';
import { Composer } from '@/components/Composer';

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

const locale = () => i18n.resolvedLanguage || 'vi';
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

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, filter]);
  // Switching channel always starts at the newest message.
  useEffect(() => {
    atBottom.current = true;
  }, [filter]);

  const isNeeds = filter === INBOX_CHANNEL.needs;
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
        />
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
          }}
          className="min-h-0 flex-1 overflow-auto px-6 py-5"
        >
          <div className="flex min-h-full w-full flex-col">
            {isNeeds ? (
              <NeedsList tasks={pending.tasks} questions={pending.messages} />
            ) : (
              <>
                {items.length === 0 && (
                  <EmptyThread
                    kind={h.agents.length === 0 ? 'noAgents' : 'conversation'}
                    onAddAgent={() => navigate(`${PAGE.agents}/new`)}
                  />
                )}
                {items.map((m, i) => (
                  <div key={m.id}>
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
                  </div>
                ))}
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
      </section>
    </div>
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
}: {
  filter: string;
  needsCount: number;
  agent?: Agent;
  task?: Task;
  onClose: () => void;
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
    <header className="flex h-16 shrink-0 items-center gap-3 border-b px-6">
      {task && (
        <Button variant="ghost" size="icon-sm" aria-label={t('nav.inbox')} onClick={onClose}>
          <ArrowLeft />
        </Button>
      )}
      {icon}
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold">{title}</h1>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {agent && (
        <Button variant="outline" size="sm" onClick={() => navigate(`${PAGE.agents}/${agent.id}`)}>
          <Bot />
          {t('inbox.viewAgent')}
        </Button>
      )}
    </header>
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
  return (
    <div className={cn('group flex gap-3 rounded-lg px-2 py-0.5 hover:bg-muted/40', !grouped && 'mt-3')}>
      {grouped ? (
        <span className="w-8 shrink-0 pt-0.5 text-right text-[0.65rem] text-muted-foreground opacity-0 group-hover:opacity-100">
          {timeOf(m.createdAt)}
        </span>
      ) : (
        <span className="pt-0.5">
          <Avatar agent={sender} size={32} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <span className="font-medium">{nameOf(m.fromId)}</span>
            {showRecipient && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <ArrowRight size={12} />
                {nameOf(m.toId)}
              </span>
            )}
            <span className="ml-1 text-xs text-muted-foreground">{timeOf(m.createdAt)}</span>
          </div>
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
        {m.subject && <div className="mt-1 text-sm font-medium">{m.subject}</div>}
        {m.body && <p className="mt-0.5 text-sm/6 whitespace-pre-wrap text-foreground/90">{m.body}</p>}
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
          <div className="mt-2 flex flex-wrap gap-2">
            {isWaitingOnUser && (
              <Button size="xs" onClick={onAnswer}>
                <CircleHelp />
                {t('inbox.answerInNeeds')}
              </Button>
            )}
            {task && !isInTaskThread && (
              <Button variant="outline" size="xs" onClick={() => onOpenTask(task.id)}>
                <List />
                {task.key} · {task.title}
              </Button>
            )}
          </div>
        )}
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
      <div className="mb-5 grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon size={22} />
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
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {title}
        <Badge variant="secondary">{count}</Badge>
      </h2>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function NeedTask({ task }: { task: Task }) {
  const h = useHub();
  const [note, setNote] = useState('');
  const assignee = h.agentById(task.assigneeId ?? '');
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
          <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
          {task.result && (
            <p className="mt-3 line-clamp-6 rounded-lg bg-muted/60 p-3 text-sm/6 whitespace-pre-wrap">{task.result}</p>
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
              placeholder={isReview ? t('inbox.noteOptional') : t('inbox.answerPlaceholder')}
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
  const reply = async (e: FormEvent) => {
    e.preventDefault();
    if (!h.ws || !asker || !answer.trim()) return;
    const sent = await h.attempt(
      () => api.send(h.ws!.id, { to: asker.id, body: answer, subject: m.subject }),
      t('inbox.replySent'),
    );
    if (sent) setAnswer('');
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
          <p className="mt-1 text-sm/6 whitespace-pre-wrap text-foreground/90">{m.body}</p>
          <form className="mt-3 flex gap-2" onSubmit={reply}>
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              aria-label={t('inbox.answerPlaceholder')}
              placeholder={t('inbox.answerPlaceholder')}
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
