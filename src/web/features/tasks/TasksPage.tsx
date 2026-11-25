import { useState, type DragEvent } from 'react';
import { List, MoreHorizontal, Plus, Search, Columns3, Trash2, Zap } from 'lucide-react';
import { useHub, waitingText } from '@/lib/hub';
import { api, TASK_STATUS, USER_ID, type Task, type TaskStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TaskChanges } from '@/components/TaskChanges';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Avatar, Field, PageHeading, TASK_TONE, label, type Tone } from '@/components/shared';

/** Select value meaning "no filter" / "no choice" (Radix Select cannot use an empty string). */
const ANY = 'all';
const NONE = 'none';
const VIEW = { board: 'board', list: 'list' } as const;

const BOARD_STATUSES = [
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.blocked,
  TASK_STATUS.done,
] as const;

/** Workflow steps have no fixed meaning, so they cycle through the chart palette. */
const STEP_TONES: Tone[] = [
  { column: 'border-chart-1 bg-chart-1/5', dot: 'bg-chart-1' },
  { column: 'border-chart-3 bg-chart-3/5', dot: 'bg-chart-3' },
  { column: 'border-chart-4 bg-chart-4/5', dot: 'bg-chart-4' },
  { column: 'border-chart-5 bg-chart-5/5', dot: 'bg-chart-5' },
  { column: 'border-chart-2 bg-chart-2/5', dot: 'bg-chart-2' },
];

export function TasksPage() {
  const h = useHub();
  const [mode, setMode] = useState<string>(VIEW.board),
    [query, setQuery] = useState(''),
    [wf, setWf] = useState<string>(ANY),
    [agent, setAgent] = useState<string>(ANY),
    [status, setStatus] = useState<string>(ANY),
    [draggedId, setDraggedId] = useState<string | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [create, setCreate] = useState(false);
  const tasks = h.tasks.filter(
    (t) =>
      t.status !== TASK_STATUS.archived &&
      `${t.key} ${t.title} ${t.body}`.toLowerCase().includes(query.toLowerCase()) &&
      (wf === ANY || t.workflowId === wf) &&
      (agent === ANY || t.assigneeId === agent) &&
      (status === ANY || t.status === status),
  );
  // Read the task from live hub state so the sheet follows server updates (approve, step changes).
  const selected = h.tasks.find((x) => x.id === selectedId) ?? null;
  const workflow = wf !== ANY ? h.workflows.find((w) => w.id === wf) : undefined;
  const statusColumn = (status: TaskStatus) => ({
    key: status,
    title: t(`tasks.code.${status}`),
    hint: t(label[status]),
    tone: TASK_TONE[status],
    statuses: [status],
  });
  const cols: { key: string; title: string; hint: string; tone: Tone; statuses: TaskStatus[] }[] = workflow
    ? [
        ...workflow.steps.map((s, i) => ({
          key: s.id,
          title: s.name.toUpperCase(),
          hint: h.agentById(s.agentId)?.name ?? t('common.you'),
          tone: STEP_TONES[i % STEP_TONES.length]!,
          statuses: [],
        })),
        statusColumn(TASK_STATUS.done),
      ]
    : BOARD_STATUSES.map(statusColumn);
  const moveTask = async (taskId: string, nextStatus: TaskStatus) => {
    const task = h.tasks.find((item) => item.id === taskId);
    if (!task || task.status === nextStatus) return;
    await h.attempt(() => api.updateTask(taskId, { status: nextStatus }), t('tasks.taskMoved'));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeading
        title={t('tasks.title')}
        subtitle={t('tasks.trackWorkFromStartToFinish')}
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            {t('tasks.newTask')}
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 text-muted-foreground" size={15} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('tasks.searchTasks')}
            className="w-56 pl-8"
          />
        </div>
        <Select value={wf} onValueChange={setWf}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('workflows.allWorkflows')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('workflows.allWorkflows')}</SelectItem>
            {h.workflows.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={agent} onValueChange={setAgent}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('tasks.everyone')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('tasks.everyone')}</SelectItem>
            <SelectItem value="user">{t('common.you')}</SelectItem>
            {h.agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === VIEW.list && (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label={t('common.status')}>
              <SelectValue placeholder={t('tasks.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('tasks.allStatuses')}</SelectItem>
              {BOARD_STATUSES.map((taskStatus) => (
                <SelectItem key={taskStatus} value={taskStatus}>
                  {t(label[taskStatus])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Tabs value={mode} onValueChange={setMode} className="ml-auto">
          <TabsList>
            <TabsTrigger value={VIEW.board}>
              <Columns3 size={14} />
              {t('tasks.board')}
            </TabsTrigger>
            <TabsTrigger value={VIEW.list}>
              <List size={14} />
              {t('tasks.list')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {mode === VIEW.board ? (
        // Columns share the full width; only a long workflow falls back to scrolling sideways.
        <div className="grid min-h-0 flex-1 auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
          {cols.map(({ key, title, hint, tone, statuses }) => {
            const group = tasks.filter((x) =>
              statuses.length ? statuses.includes(x.status) : x.stepId === key && x.status !== TASK_STATUS.done,
            );
            return (
              <section
                key={key}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId = event.dataTransfer.getData('text/task-id') || draggedId;
                  if (taskId && statuses.length === 1) void moveTask(taskId, statuses[0]!);
                  setDraggedId(null);
                }}
                className={cn('flex min-h-0 flex-col rounded-lg border-t-2 p-2.5', tone.column)}
              >
                <header className="flex items-center gap-2 px-1 pb-3" title={hint}>
                  <span className={cn('size-2 rounded-full', tone.dot)} />
                  <h2 className="truncate text-xs font-semibold tracking-wider">{title}</h2>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{group.length}</span>
                </header>
                <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain pr-1">
                  <div className="grid content-start gap-2">
                    {group.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        open={() => setSelectedId(task.id)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/task-id', task.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDraggedId(task.id);
                        }}
                        onDragEnd={() => setDraggedId(null)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <div className="grid grid-cols-[100px_1fr_150px_160px_130px] gap-3 bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
            <span>{t('common.id')}</span>
            <span>{t('common.title')}</span>
            <span>{t('common.status')}</span>
            <span>{t('workflows.workflow')}</span>
            <span>{t('tasks.assignee')}</span>
          </div>
          {tasks.map((task) => (
            <Button
              key={task.id}
              variant="ghost"
              onClick={() => setSelectedId(task.id)}
              className="grid h-auto w-full grid-cols-[100px_1fr_150px_160px_130px] justify-items-start gap-3 rounded-none border-t px-4 py-3 text-left font-normal"
            >
              <span className="font-mono text-muted-foreground">{task.key}</span>
              <span className="truncate">{task.title}</span>
              <span className="flex items-center gap-2 text-xs font-semibold tracking-wider">
                <span className={cn('size-2 rounded-full', TASK_TONE[task.status].dot)} />
                {t(`tasks.code.${task.status}`)}
              </span>
              <span className="truncate">{h.workflows.find((w) => w.id === task.workflowId)?.name || '—'}</span>
              <span>
                {h.agentById(task.assigneeId)?.name ||
                  (task.assigneeId === USER_ID ? t('common.you') : t('tasks.unassigned'))}
              </span>
            </Button>
          ))}
        </div>
      )}
      <TaskSheet task={selected} close={() => setSelectedId(null)} />
      <CreateTask open={create} close={() => setCreate(false)} />
    </div>
  );
}

function TaskCard({
  task,
  open,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  open: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const h = useHub();
  return (
    <Button
      variant="outline"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={open}
      className="h-auto w-full cursor-grab flex-col items-stretch gap-0 bg-card p-3 text-left font-normal whitespace-normal hover:border-primary/40 active:cursor-grabbing"
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{task.key}</span>
        <MoreHorizontal size={15} />
      </div>
      <div className="mt-2 leading-5 font-medium">{task.title}</div>
      <div className="mt-3 flex items-center gap-1.5">
        <Badge variant="outline" className="max-w-32 truncate">
          {h.workflows.find((w) => w.id === task.workflowId)?.name || t('tasks.taskLabel')}
        </Badge>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {h.agentById(task.assigneeId)?.name || (task.assigneeId === USER_ID ? t('common.you') : '—')}
          <Avatar agent={h.agentById(task.assigneeId)} size={20} />
        </div>
      </div>
    </Button>
  );
}

function TaskSheet({ task, close }: { task: Task | null; close: () => void }) {
  const h = useHub();
  const [note, setNote] = useState('');
  const [answer, setAnswer] = useState('');
  const wf = h.workflows.find((w) => w.id === task?.workflowId);
  const messages = h.messages.filter((m) => m.taskId === task?.id);
  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && close()}>
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b pr-10">
          <Badge variant="outline" className="w-fit font-mono">
            {task?.key}
          </Badge>
          <SheetTitle className="text-xl">{task?.title}</SheetTitle>
          <SheetDescription>
            {t(label[task?.status || TASK_STATUS.todo])} · {wf?.name || t('tasks.standaloneTask')}
          </SheetDescription>
        </SheetHeader>
        {task && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-5 px-4 py-5">
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('common.description')}</h3>
                <p className="leading-6 whitespace-pre-wrap">{task.body || t('tasks.noDescription')}</p>
              </div>
              {wf && (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('tasks.workflowProgress')}</h3>
                  <div className="space-y-2">
                    {wf.steps.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-2 text-sm">
                        <span
                          className={`grid size-5 place-items-center rounded-full text-xs ${task.stepId === s.id ? 'bg-primary text-primary-foreground' : i < wf.steps.findIndex((x) => x.id === task.stepId) ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}
                        >
                          {i + 1}
                        </span>
                        {s.name}
                        <span className="text-xs text-muted-foreground">
                          · {h.agentById(s.agentId)?.name || t('common.you')}
                        </span>
                        {s.approval && <Badge variant="secondary">{t('common.approve')}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {task.result && (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('tasks.latestResult')}</h3>
                  <Card className="p-3 leading-6 whitespace-pre-wrap">{task.result}</Card>
                </div>
              )}
              <TaskChanges key={task.id} task={task} />
              {(task.status === TASK_STATUS.review || task.status === TASK_STATUS.blocked) &&
                waitingText(task, h.workflows) && (
                  <p className="text-sm text-warning">{waitingText(task, h.workflows)}</p>
                )}
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('inbox.relatedConversation')}</h3>
                {messages.length ? (
                  messages.map((m) => (
                    <div key={m.id} className="border-t py-2 text-sm">
                      <span className="font-medium">
                        {h.agentById(m.fromId)?.name || (m.fromId === USER_ID ? t('common.you') : t('common.hub'))}
                      </span>
                      <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">{t('inbox.noMessagesYet')}</p>
                )}
              </div>
            </div>
          </div>
        )}
        {task && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-popover p-4">
            {task.status === TASK_STATUS.todo && (
              <Button size="sm" onClick={() => h.attempt(() => api.startTask(task.id), t('tasks.taskStarted'))}>
                <Zap size={14} />
                {t('common.start')}
              </Button>
            )}
            {task.status === TASK_STATUS.review && (
              <>
                <Input
                  className="min-w-28 flex-1"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-label={t('common.note')}
                  placeholder={t('common.note')}
                />
                <Button
                  size="sm"
                  onClick={async () =>
                    (await h.attempt(() => api.decide(task.id, true, note), t('inbox.approved'))) && setNote('')
                  }
                >
                  {t('common.approve')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () =>
                    (await h.attempt(() => api.decide(task.id, false, note), t('inbox.returned'))) && setNote('')
                  }
                >
                  {t('common.sendBack')}
                </Button>
              </>
            )}
            {task.status === TASK_STATUS.blocked && (
              <>
                <Input
                  className="min-w-28 flex-1"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  aria-label={t('tasks.replyToAgent')}
                  placeholder={t('tasks.replyToAgent')}
                />
                <Button
                  size="sm"
                  onClick={async () =>
                    (await h.attempt(() => api.answer(task.id, answer), t('tasks.replySent'))) && setAnswer('')
                  }
                  disabled={!answer.trim()}
                >
                  {t('common.send')}
                </Button>
              </>
            )}
            {task.status === TASK_STATUS.done && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  h.attempt(() => api.updateTask(task.id, { status: TASK_STATUS.archived }), t('tasks.archived'))
                }
              >
                {t('common.archive')}
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              onClick={async () => {
                if (await h.attempt(() => api.deleteTask(task.id), t('tasks.taskDeleted'))) close();
              }}
            >
              <Trash2 size={14} />
              {t('common.delete')}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateTask({ open, close }: { open: boolean; close: () => void }) {
  const h = useHub();
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [wf, setWf] = useState<string>(NONE),
    [assignee, setAssignee] = useState<string>(NONE);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="gap-0">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle>{t('tasks.newTask')}</SheetTitle>
          <SheetDescription>{t('tasks.createDescription')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-4">
            <Field label={t('common.title')} isRequired>
              <Input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('tasks.titlePlaceholder')}
              />
            </Field>
            <Field label={t('common.description')}>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
            </Field>
            <Field label={t('workflows.workflow')}>
              <Select value={wf} onValueChange={setWf}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('workflows.noWorkflow')}</SelectItem>
                  {h.workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {wf === NONE && (
              <Field label={t('tasks.assignee')}>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('tasks.unassigned')}</SelectItem>
                    <SelectItem value="user">{t('common.you')}</SelectItem>
                    {h.agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
        </div>
        <div className="shrink-0 border-t bg-popover p-4">
          <Button
            disabled={!title.trim()}
            onClick={async () => {
              if (!h.ws) return;
              const out = await h.attempt(
                () =>
                  api.createTask(h.ws!.id, {
                    title,
                    body,
                    workflowId: wf === NONE ? null : wf,
                    assigneeId: wf === NONE && assignee !== NONE ? assignee : null,
                  }),
                t('tasks.taskCreated'),
              );
              if (out) close();
            }}
          >
            {t('tasks.createTask')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
