import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CircleHelp, Hash, List, RotateCcw, Send, Zap } from 'lucide-react';
import { useHub, waitingOnUser, waitingText } from '@/lib/hub';
import { AGENT_STATUS, api, DECISION, MESSAGE_STATUS, TASK_STATUS, USER_ID, type Message, type Task } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { i18n, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Avatar, label } from '@/components/shared';

const actTranslation: Record<Message['act'], string> = {
  request: 'inbox.actRequest',
  query: 'inbox.actQuery',
  inform: 'inbox.actInform',
  done: 'inbox.actDone',
  needs_human: 'inbox.actNeedsHuman',
  reply: 'inbox.actReply',
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
const AGENT_THREAD = 'agent:';
const TASK_THREAD = 'task:';

/** Messages from the same sender this close together share one header, like Slack. */
const GROUP_WINDOW_MS = 5 * 60_000;
/** Only follow new messages when the reader is already near the bottom. */
const STICK_TO_BOTTOM_PX = 120;

export function InboxPage({ filter, setFilter }: { filter: string; setFilter: (s: string) => void }) {
  const h = useHub();
  const [compose, setCompose] = useState('');
  const [recipient, setRecipient] = useState('');
  const [urgent, setUrgent] = useState(false);
  const pending = waitingOnUser(h.tasks, h.messages);
  const selectedTask = filter.startsWith(TASK_THREAD) ? filter.slice(TASK_THREAD.length) : null;
  const selectedAgent = filter.startsWith(AGENT_THREAD) ? filter.slice(AGENT_THREAD.length) : null;
  const items = h.messages.filter((m) =>
    filter === INBOX_CHANNEL.team
      ? true
      : selectedAgent
        ? m.fromId === selectedAgent || m.toId === selectedAgent
        : selectedTask
          ? m.taskId === selectedTask
          : false,
  );
  const defaultRecipient = selectedAgent || h.agents.find((a) => a.isOrchestrator)?.id || h.agents[0]?.id || '';
  const to = recipient || defaultRecipient;

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, filter]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!compose.trim() || !h.ws || !to) return;
    const sent = await h.attempt(() =>
      api.send(h.ws!.id, { to, body: compose, urgent, taskId: selectedTask || undefined }),
    );
    // Keep the draft when sending fails so nothing typed is lost.
    if (sent) {
      setCompose('');
      setUrgent(false);
    }
  };

  const title =
    filter === INBOX_CHANNEL.needs
      ? t('inbox.needsYou')
      : selectedTask
        ? `${t('tasks.taskLabel')} ${h.tasks.find((x) => x.id === selectedTask)?.key || ''}`
        : selectedAgent
          ? h.agentById(selectedAgent)?.name
          : t('inbox.everyone');

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-96 overflow-hidden rounded-xl border bg-card/30">
      <aside className="w-60 shrink-0 border-r bg-card/50 p-3">
        <SectionLabel>{t('inbox.title')}</SectionLabel>
        <div className="grid gap-1">
          <Channel
            active={filter === INBOX_CHANNEL.needs}
            onClick={() => setFilter(INBOX_CHANNEL.needs)}
            count={pending.count}
          >
            <CircleHelp />
            {t('inbox.needsYou')}
          </Channel>
          <Channel active={filter === INBOX_CHANNEL.team} onClick={() => setFilter(INBOX_CHANNEL.team)}>
            <Hash />
            {t('inbox.everyone')}
          </Channel>
        </div>
        <SectionLabel className="pt-6">{t('agents.title')}</SectionLabel>
        <div className="grid gap-1">
          {h.agents.map((a) => (
            <Channel key={a.id} active={selectedAgent === a.id} onClick={() => setFilter(AGENT_THREAD + a.id)}>
              <Avatar agent={a} size={22} />
              {a.name}
            </Channel>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b px-5 font-medium">
          {title}
          {filter !== INBOX_CHANNEL.needs && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {items.length} {t('inbox.messages')}
            </span>
          )}
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
          }}
          className="flex-1 overflow-auto p-5"
        >
          {filter === INBOX_CHANNEL.needs ? (
            <div className="space-y-2">
              {pending.tasks.map((task) => (
                <NeedTask key={task.id} task={task} />
              ))}
              {pending.messages.map((m) => (
                <NeedQuestion key={m.id} message={m} />
              ))}
              {pending.count === 0 && <EmptyThread />}
            </div>
          ) : (
            <>
              {items.length === 0 && <EmptyThread />}
              {items.map((m, i) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  grouped={continuesGroup(items[i - 1], m)}
                  onOpenTask={(id) => setFilter(TASK_THREAD + id)}
                />
              ))}
              <WorkingLine />
            </>
          )}
        </div>

        {filter !== INBOX_CHANNEL.needs && (
          <form onSubmit={send} className="border-t p-3">
            <div className="rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/40">
              <Textarea
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                aria-label={t('inbox.composerPlaceholder')}
                placeholder={t('inbox.composerPlaceholder')}
                className="min-h-20 resize-none border-0 shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center gap-2 px-2 pb-2">
                <Select value={to} onValueChange={setRecipient}>
                  <SelectTrigger size="sm" className="w-44 text-xs" aria-label={t('inbox.recipient')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {h.agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        {a.isOrchestrator ? ` · ${t('agents.orchestrator')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch size="sm" checked={urgent} onCheckedChange={setUrgent} />
                  <Zap size={13} />
                  {t('inbox.urgent')}
                </label>
                <Button size="sm" className="ml-auto" disabled={!compose.trim() || !to}>
                  <Send />
                  {t('common.send')}
                </Button>
              </div>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function continuesGroup(prev: Message | undefined, m: Message): boolean {
  if (!prev || prev.fromId !== m.fromId || prev.taskId !== m.taskId) return false;
  return Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
}

function MessageRow({
  message: m,
  grouped,
  onOpenTask,
}: {
  message: Message;
  grouped: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const h = useHub();
  const sender = h.agentById(m.fromId);
  const task = m.taskId ? h.tasks.find((x) => x.id === m.taskId) : undefined;
  return (
    <div className={cn('flex gap-2.5', grouped ? 'mt-1' : 'mt-4 first:mt-0')}>
      {grouped ? <div className="w-7.5 shrink-0" /> : <Avatar agent={sender} size={30} />}
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">
              {sender?.name || (m.fromId === USER_ID ? t('common.you') : t('common.hub'))}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(m.createdAt).toLocaleTimeString(i18n.resolvedLanguage || 'vi', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{t(actTranslation[m.act])}</Badge>
          {m.decision && (
            <Badge variant="outline">{t(m.decision === DECISION.approve ? 'inbox.approved' : 'inbox.returned')}</Badge>
          )}
          {m.urgent && <Badge variant="destructive">{t('inbox.urgent')}</Badge>}
          {m.status !== MESSAGE_STATUS.delivered && (
            <Badge variant="outline" className={cn(m.status === MESSAGE_STATUS.failed && 'text-destructive')}>
              {t(statusTranslation[m.status])}
            </Badge>
          )}
        </div>
        {m.subject && <div className="mt-1 text-sm font-medium">{m.subject}</div>}
        {m.body && <p className="mt-1 text-sm/6 whitespace-pre-wrap text-foreground/85">{m.body}</p>}
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
        {task && (
          <Button variant="outline" size="xs" className="mt-2" onClick={() => onOpenTask(task.id)}>
            <List />
            {task.key} · {task.title}
          </Button>
        )}
      </div>
    </div>
  );
}

function WorkingLine() {
  const h = useHub();
  const working = h.agents.filter((a) => a.status === AGENT_STATUS.working);
  if (!working.length) return null;
  return (
    <div className="mt-4 flex items-center gap-2 pl-10 text-xs text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        <span className="size-1 animate-pulse rounded-full bg-primary" />
        <span className="size-1 animate-pulse rounded-full bg-primary" />
        <span className="size-1 animate-pulse rounded-full bg-primary" />
      </span>
      {working.map((a) => a.name).join(', ')} {t('agents.working')}
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="grid h-full min-h-48 place-items-center text-sm text-muted-foreground">
      {t('inbox.noConversationsHereYet')}
    </div>
  );
}

function SectionLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('px-2 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase', className)}>
      {children}
    </div>
  );
}

function Channel({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('w-full justify-start font-normal', active ? 'bg-accent font-medium' : 'text-muted-foreground')}
    >
      {children}
      {!!count && <span className="ml-auto text-xs">{count}</span>}
    </Button>
  );
}

function NeedTask({ task }: { task: Task }) {
  const h = useHub();
  const [note, setNote] = useState('');
  const reason = waitingText(task, h.workflows) || t(label[task.status]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (await h.attempt(fn, ok)) setNote('');
  };
  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <div className="grid size-8 place-items-center rounded-lg bg-warning/15 text-warning">
          <CircleHelp size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {task.key} · {task.title}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{reason}</p>
          {task.result && (
            <p className="mt-1 line-clamp-3 text-xs whitespace-pre-wrap text-foreground/80">{task.result}</p>
          )}
          <div className="mt-3 flex gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={task.status === TASK_STATUS.review ? t('inbox.noteOptional') : t('inbox.answerPlaceholder')}
              placeholder={task.status === TASK_STATUS.review ? t('inbox.noteOptional') : t('inbox.answerPlaceholder')}
              className="h-8"
            />
            {task.status === TASK_STATUS.review ? (
              <>
                <Button size="sm" onClick={() => act(() => api.decide(task.id, true, note), t('inbox.approved'))}>
                  <Check />
                  {t('common.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act(() => api.decide(task.id, false, note), t('inbox.returned'))}
                >
                  {t('common.sendBack')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                aria-label={t('common.send')}
                disabled={!note.trim()}
                onClick={() => act(() => api.answer(task.id, note), t('inbox.replySent'))}
              >
                <Send />
              </Button>
            )}
          </div>
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
  const reply = async () => {
    if (!h.ws || !asker) return;
    const sent = await h.attempt(
      () => api.send(h.ws!.id, { to: asker.id, body: answer, subject: m.subject }),
      t('inbox.replySent'),
    );
    if (sent) setAnswer('');
  };
  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <Avatar agent={asker} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {asker?.name}
            {m.subject && ` · ${m.subject}`}
          </div>
          <p className="mt-1 text-sm/6 whitespace-pre-wrap text-foreground/85">{m.body}</p>
          <div className="mt-3 flex gap-2">
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              aria-label={t('inbox.answerPlaceholder')}
              placeholder={t('inbox.answerPlaceholder')}
              className="h-8"
            />
            <Button size="sm" aria-label={t('common.send')} disabled={!answer.trim() || !asker} onClick={reply}>
              <Send />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
