import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronsUpDown,
  History,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { PAGE, useHub, agentState } from '@/lib/hub';
import {
  api,
  ENGINE,
  ISOLATION,
  ISOLATIONS,
  workTokens,
  type Agent,
  type EngineInfo,
  type TokenTotal,
} from '@/lib/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { i18n, t } from '@/lib/i18n';
import { Avatar, ConfirmButton, Empty, Field, FolderField, PageHeading, statusDot, uid } from '@/components/shared';

function tokensTodayOf(tokens: TokenTotal[], agentId: string): number {
  const total = tokens.find((x) => x.agentId === agentId);
  return total ? workTokens(total) : 0;
}

export function AgentsPage({ openCreate = false }: { openCreate?: boolean }) {
  const h = useHub();
  const [open, setOpen] = useState(false),
    [agent, setAgent] = useState<Agent | null>(null);
  const closeEditor = () => {
    setOpen(false);
    if (openCreate) location.hash = `/${PAGE.agents}`;
  };
  return (
    <>
      <PageHeading
        title={t('agents.title')}
        subtitle={t('agents.description')}
        action={
          <Button
            onClick={() => {
              setAgent(null);
              setOpen(true);
            }}
          >
            <Plus size={16} />
            {t('agents.addAgent')}
          </Button>
        }
      />
      {h.agents.length === 0 ? (
        <Empty icon={<Bot />} title={t('agents.noAgentsYet')} body={t('agents.addFirstAgentDescription')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {h.agents.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-center gap-3">
                <Avatar agent={a} size={42} />
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {a.name} {a.isOrchestrator && <Badge variant="secondary">{t('agents.orchestrator')}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.engine} · {a.model || t('common.default')}
                  </div>
                </div>
                <span className={`ml-auto size-2 rounded-full ${statusDot[agentState(a, h.messages)]}`} />
              </div>
              <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                {a.role || t('agents.noRoleDescription')}
              </p>
              <div className="mt-3 flex justify-between border-t pt-3 text-xs text-muted-foreground">
                <span>{a.sessionId ? t('agents.sessionConnected') : t('agents.noSession')}</span>
                <span>
                  {tokensTodayOf(h.tokens, a.id).toLocaleString()} {t('agents.tokensToday')}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => (location.hash = `/${PAGE.agents}/${a.id}`)}
                >
                  <History />
                  {t('agents.runHistory')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAgent(a);
                    setOpen(true);
                  }}
                >
                  <Settings2 />
                  {t('common.configure')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <AgentEditor
        open={h.agents.some((member) => member.isOrchestrator) && (open || openCreate)}
        close={closeEditor}
        agent={agent}
      />
    </>
  );
}

export function LeadAgentDialog() {
  return (
    <AgentEditor
      open
      agent={null}
      isLeadAgent
      close={() => {
        if (location.hash === `#/${PAGE.agents}/new`) location.hash = `/${PAGE.agents}`;
      }}
    />
  );
}

type AgentForm = Pick<
  Agent,
  | 'name'
  | 'avatarSeed'
  | 'tint'
  | 'role'
  | 'goal'
  | 'engine'
  | 'model'
  | 'command'
  | 'extraArgs'
  | 'isolation'
  | 'cwd'
  | 'isOrchestrator'
>;

// Tints are agent data (stored as hex and drawn as the avatar background), not theme colors.
const AVATAR_TINTS = ['#f6bf1d', '#f4a28c', '#9fd3c7', '#a5b4fc', '#f9a8d4', '#86efac'] as const;
const AVATAR_CHOICES = 7;
const randomSeed = () => uid().slice(0, 8);

/** New agents start on Claude with that engine's defaults (e.g. edits allowed, since headless turns cannot ask). */
function formValues(agent: Agent | null, claude: EngineInfo | undefined, isLeadAgent: boolean): AgentForm {
  return {
    name: agent?.name ?? '',
    avatarSeed: agent ? agent.avatarSeed || agent.name : randomSeed(),
    tint: agent?.tint ?? AVATAR_TINTS[0],
    role: agent?.role ?? '',
    goal: agent?.goal ?? '',
    engine: agent?.engine ?? ENGINE.claude,
    model: agent?.model ?? '',
    command: agent?.command ?? claude?.defaultCommand ?? '',
    extraArgs: agent?.extraArgs ?? claude?.defaultExtraArgs ?? '',
    isolation: agent?.isolation ?? ISOLATION.worktree,
    cwd: agent?.cwd ?? '',
    isOrchestrator: agent?.isOrchestrator ?? isLeadAgent,
  };
}

function AgentEditor({
  open,
  close,
  agent,
  isLeadAgent = false,
}: {
  open: boolean;
  close: () => void;
  agent: Agent | null;
  isLeadAgent?: boolean;
}) {
  const h = useHub();
  const claude = h.meta?.engines.find((e) => e.id === ENGINE.claude);
  const [v, setV] = useState(() => formValues(agent, claude, isLeadAgent));
  useEffect(() => setV(formValues(agent, claude, isLeadAgent)), [agent, open, claude, isLeadAgent]);
  // Functional update: the engine picker sets two fields in one event.
  const set = <K extends keyof AgentForm>(k: K, x: AgentForm[K]) => setV((cur) => ({ ...cur, [k]: x }));
  const engineInfo = h.meta?.engines.find((e) => e.id === v.engine);
  const fields = (
    <div className="grid gap-4 px-6 pb-6">
      <Field label={t('common.name')}>
        <Input value={v.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <AvatarPicker
        name={v.name}
        seed={v.avatarSeed}
        tint={v.tint}
        onSeedChange={(seed) => set('avatarSeed', seed)}
        onTintChange={(tint) => set('tint', tint)}
      />
      <Field label={t('agents.rolePrompt')}>
        <Textarea rows={4} value={v.role} onChange={(e) => set('role', e.target.value)} />
      </Field>
      <Field label={t('agents.goal')}>
        <Textarea
          rows={2}
          value={v.goal}
          placeholder={t('agents.goalPlaceholder')}
          onChange={(e) => set('goal', e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('agents.engine')}>
          <Select
            value={v.engine}
            onValueChange={(x) => {
              const info = h.meta?.engines.find((e) => e.id === x);
              if (!info) return;
              set('engine', info.id);
              set('command', info.defaultCommand);
              set('extraArgs', info.defaultExtraArgs);
              // A model id from another engine would make the new CLI fail at start.
              set('model', '');
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(h.meta?.engines ?? []).map((engine) => (
                <SelectItem key={engine.id} value={engine.id}>
                  {engine.label}
                  {engine.supported ? '' : t('agents.unsupported')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('agents.model')}>
          <ModelPicker engine={engineInfo} value={v.model} onChange={(x) => set('model', x)} />
        </Field>
      </div>
      {engineInfo?.installed === false && (
        <p className="-mt-2 text-xs text-warning">
          {t('agents.engineNotInstalled', { command: engineInfo.defaultCommand })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('agents.command')}>
          <Input value={v.command} onChange={(e) => set('command', e.target.value)} />
        </Field>
        <Field label={t('agents.extraArguments')}>
          <Input value={v.extraArgs} onChange={(e) => set('extraArgs', e.target.value)} />
        </Field>
      </div>
      <Field label={t('agents.isolation')}>
        <Select
          value={v.isolation}
          onValueChange={(x) => {
            const isolation = ISOLATIONS.find((i) => i === x);
            if (isolation) set('isolation', isolation);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ISOLATIONS.map((x) => (
              <SelectItem key={x} value={x}>
                {x}
                {x === ISOLATION.worktree && <span className="text-muted-foreground">{t('agents.recommended')}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {v.isolation === ISOLATION.custom && (
        <FolderField label={t('agents.workingDirectory')} value={v.cwd} onChange={(path) => set('cwd', path)} />
      )}
      {agent && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => h.attempt(() => api.testAgent(agent.id), t('agents.testRunQueued'))}
          >
            <Play />
            {t('agents.testRun')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => h.attempt(() => api.newSession(agent.id), t('agents.newSessionCreated'))}
          >
            <RotateCcw />
            {t('agents.newSession')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              h.attempt(() => api.updateAgent(agent.id, { paused: !agent.paused }), t('agents.agentUpdated'))
            }
          >
            {agent.paused ? <Play /> : <Pause />}
            {agent.paused ? t('common.resume') : t('common.pause')}
          </Button>
          {!agent.isOrchestrator && (
            <ConfirmButton
              className="ml-auto"
              title={t('agents.deleteAgentTitle', { name: agent.name })}
              description={t('agents.deleteAgentDescription')}
              onConfirm={async () => {
                if (await h.attempt(() => api.deleteAgent(agent.id), t('agents.agentDeleted'))) close();
              }}
            >
              <Trash2 />
              {t('common.delete')}
            </ConfirmButton>
          )}
        </div>
      )}
      <Button
        disabled={!v.name.trim() || engineInfo?.supported === false}
        onClick={async () => {
          if (!h.ws) return;
          const out = agent
            ? await h.attempt(() => api.updateAgent(agent.id, v), t('agents.agentSaved'))
            : await h.attempt(() => api.createAgent(h.ws!.id, v), t('agents.agentCreated'));
          if (out) close();
        }}
      >
        {agent ? t('agents.saveAgent') : t('agents.createAgent')}
      </Button>
    </div>
  );
  if (isLeadAgent) {
    return (
      <Dialog open={open}>
        <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto p-0 sm:max-w-4xl" showCloseButton={false}>
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="text-2xl font-semibold">{t('agents.createLeadAgent')}</DialogTitle>
            <DialogDescription>{t('agents.firstAgentDescription')}</DialogDescription>
          </DialogHeader>
          {fields}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{agent ? t('agents.agentSettings') : t('agents.addAgent')}</SheetTitle>
          <SheetDescription>{t('agents.settingsDescription')}</SheetDescription>
        </SheetHeader>
        {fields}
      </SheetContent>
    </Sheet>
  );
}

/** A row of generated faces to pick from (shuffle for more) and a background tint. */
function AvatarPicker({
  name,
  seed,
  tint,
  onSeedChange,
  onTintChange,
}: {
  name: string;
  seed: string;
  tint: string;
  onSeedChange: (seed: string) => void;
  onTintChange: (tint: string) => void;
}) {
  const freshChoices = () => Array.from({ length: AVATAR_CHOICES - 1 }, randomSeed);
  const [others, setOthers] = useState(freshChoices);
  const choices = [seed, ...others.filter((other) => other !== seed)].slice(0, AVATAR_CHOICES);
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{t('agents.avatar')}</span>
      <div className="flex flex-wrap items-center gap-2">
        {choices.map((choice) => (
          <Button
            key={choice}
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={t('agents.chooseAvatar')}
            aria-pressed={choice === seed}
            onClick={() => onSeedChange(choice)}
            className={cn(
              'rounded-full p-0',
              choice === seed && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
            )}
          >
            <Avatar agent={{ name, avatarSeed: choice, tint }} size={36} />
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={t('agents.shuffleAvatars')}
          onClick={() => setOthers(freshChoices())}
        >
          <Shuffle />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {AVATAR_TINTS.map((color) => (
          <Button
            key={color}
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t('agents.avatarColor', { color })}
            aria-pressed={color === tint}
            onClick={() => onTintChange(color)}
            style={{ backgroundColor: color }}
            className={cn('rounded-full', color === tint && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
          />
        ))}
      </div>
    </div>
  );
}

/** Pick from the engine's known models, or type any id the CLI accepts. Empty value = the CLI's default. */
function ModelPicker({
  engine,
  value,
  onChange,
}: {
  engine: EngineInfo | undefined;
  value: string;
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const models = engine?.models ?? [];
  const typed = search.trim();
  const isTypedNew = !!typed && !models.some((m) => m.id === typed);
  const pick = (model: string) => {
    onChange(model);
    setOpen(false);
    setSearch('');
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">
            {value ? (models.find((m) => m.id === value)?.label ?? value) : t('agents.cliDefault')}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder={t('agents.searchOrTypeModel')} value={search} onValueChange={setSearch} />
          <CommandList>
            {!isTypedNew && <CommandEmpty>{t('agents.noModelMatch')}</CommandEmpty>}
            <CommandGroup>
              <CommandItem value={t('agents.cliDefault')} onSelect={() => pick('')}>
                <Check className={cn(value ? 'opacity-0' : 'opacity-100')} />
                {t('agents.cliDefault')}
              </CommandItem>
              {models.map((m) => (
                <CommandItem key={m.id} value={`${m.label} ${m.id}`} onSelect={() => pick(m.id)}>
                  <Check className={cn(value === m.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="shrink-0">{m.label}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{m.id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {isTypedNew && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`use:${typed}`} onSelect={() => pick(typed)}>
                  <Plus />
                  {t('agents.useModel', { model: typed })}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function AgentDetail({ id }: { id: string }) {
  const h = useHub();
  const a = h.agentById(id);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof api.runs>>>([]);
  useEffect(() => {
    api
      .runs(id)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [id]);
  const [isEditing, setEditing] = useState(false);
  if (!a) return <div>{t('errors.agentNotFound')}</div>;
  const state = agentState(a, h.messages);
  const stats = [
    { label: t('agents.session'), value: a.sessionId ? t('agents.sessionConnected') : t('agents.noSession') },
    { label: t('agents.tokensTodayLabel'), value: tokensTodayOf(h.tokens, a.id).toLocaleString() },
    { label: t('agents.recentCost'), value: `$${runs.reduce((sum, r) => sum + r.costUsd, 0).toFixed(4)}` },
  ];
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2.5 font-normal text-muted-foreground"
        onClick={() => (location.hash = `/${PAGE.agents}`)}
      >
        <ArrowLeft />
        {t('agents.title')}
      </Button>
      <header className="mt-3 mb-6 flex items-start gap-4">
        <Avatar agent={a} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
            {a.isOrchestrator && <Badge variant="secondary">{t('agents.orchestrator')}</Badge>}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('size-2 rounded-full', statusDot[state])} />
              {t(`agents.state.${state}`)}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {a.engine} · {a.model || t('common.default')} · {a.isolation}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => h.attempt(() => api.testAgent(a.id), t('agents.testRunQueued'))}>
            <Play />
            {t('agents.testRun')}
          </Button>
          <Button
            variant="outline"
            onClick={() => h.attempt(() => api.newSession(a.id), t('agents.newSessionCreated'))}
          >
            <RotateCcw />
            {t('agents.newSession')}
          </Button>
          <Button onClick={() => setEditing(true)}>{t('common.configure')}</Button>
        </div>
      </header>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card className="col-span-2 grid grid-cols-2 gap-6 p-5">
          <div className="min-w-0">
            <h2 className="text-xs text-muted-foreground">{t('agents.role')}</h2>
            <p className={cn('mt-1.5 line-clamp-6 text-sm whitespace-pre-wrap', !a.role && 'text-muted-foreground')}>
              {a.role || t('agents.noRoleDescription')}
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="text-xs text-muted-foreground">{t('agents.goal')}</h2>
            <p className={cn('mt-1.5 line-clamp-6 text-sm whitespace-pre-wrap', !a.goal && 'text-muted-foreground')}>
              {a.goal || t('agents.noGoal')}
            </p>
          </div>
        </Card>
        <Card className="grid gap-3 p-5">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{stat.label}</span>
              <span className="font-medium tabular-nums">{stat.value}</span>
            </div>
          ))}
        </Card>
      </div>
      <h2 className="mb-3 text-base font-semibold">{t('agents.runHistory')}</h2>
      <AgentEditor open={isEditing} close={() => setEditing(false)} agent={a} />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1.5fr_repeat(5,100px)] gap-2 bg-muted/40 p-3 text-xs text-muted-foreground">
          <span>{t('agents.runs')}</span>
          <span>{t('agents.input')}</span>
          <span>{t('agents.output')}</span>
          <span>{t('agents.cacheWrites')}</span>
          <span>{t('agents.cacheReads')}</span>
          <span>{t('agents.cost')}</span>
        </div>
        {runs.length ? (
          runs.map((r) => (
            <details key={r.id} className="border-t">
              <summary className="grid cursor-pointer grid-cols-[1.5fr_repeat(5,100px)] gap-2 p-3 text-sm">
                <span>
                  {new Date(r.startedAt).toLocaleString(i18n.resolvedLanguage || 'vi')} · {r.status}
                </span>
                <span>{r.inputTokens}</span>
                <span>{r.outputTokens}</span>
                <span>{r.cacheWriteTokens}</span>
                <span>{r.cacheReadTokens}</span>
                <span>${r.costUsd.toFixed(4)}</span>
              </summary>
              <pre className="mx-3 mb-3 max-h-96 overflow-auto rounded-sm bg-muted p-3 text-xs whitespace-pre-wrap">
                {r.output}
              </pre>
            </details>
          ))
        ) : (
          <p className="p-5 text-sm text-muted-foreground">{t('agents.noRuns')}</p>
        )}
      </Card>
    </>
  );
}
