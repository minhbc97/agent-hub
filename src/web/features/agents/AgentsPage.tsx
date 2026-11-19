import { useEffect, useState } from 'react';
import { Bot, Check, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import { PAGE, useHub, agentState } from '@/lib/hub';
import { api, ENGINE, ISOLATION, ISOLATIONS, workTokens, type Agent, type EngineInfo } from '@/lib/api';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { i18n, t } from '@/lib/i18n';
import { Avatar, ConfirmButton, Empty, Field, PageHeading, statusDot } from '@/components/shared';

export function AgentsPage() {
  const h = useHub();
  const [open, setOpen] = useState(false),
    [agent, setAgent] = useState<Agent | null>(null);
  // Same count the daily token budget is checked against.
  const tokensToday = (agentId: string) => {
    const total = h.tokens.find((x) => x.agentId === agentId);
    return total ? workTokens(total) : 0;
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
                  {tokensToday(a.id).toLocaleString()} {t('agents.tokensToday')}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => (location.hash = `/${PAGE.agents}/${a.id}`)}
                >
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
                  {t('common.configure')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <AgentEditor open={open} close={() => setOpen(false)} agent={agent} />
    </>
  );
}

type AgentForm = Pick<
  Agent,
  | 'name'
  | 'role'
  | 'engine'
  | 'model'
  | 'command'
  | 'extraArgs'
  | 'isolation'
  | 'cwd'
  | 'dailyTokenBudget'
  | 'isOrchestrator'
>;

/** New agents start on Claude with that engine's defaults (e.g. edits allowed, since headless turns cannot ask). */
function formValues(agent: Agent | null, claude: EngineInfo | undefined): AgentForm {
  return {
    name: agent?.name ?? '',
    role: agent?.role ?? '',
    engine: agent?.engine ?? ENGINE.claude,
    model: agent?.model ?? '',
    command: agent?.command ?? claude?.defaultCommand ?? '',
    extraArgs: agent?.extraArgs ?? claude?.defaultExtraArgs ?? '',
    isolation: agent?.isolation ?? ISOLATION.shared,
    cwd: agent?.cwd ?? '',
    dailyTokenBudget: agent?.dailyTokenBudget ?? 0,
    isOrchestrator: agent?.isOrchestrator ?? false,
  };
}

function AgentEditor({ open, close, agent }: { open: boolean; close: () => void; agent: Agent | null }) {
  const h = useHub();
  const claude = h.meta?.engines.find((e) => e.id === ENGINE.claude);
  const [v, setV] = useState(() => formValues(agent, claude));
  useEffect(() => setV(formValues(agent, claude)), [agent, open, claude]);
  // Functional update: the engine picker sets two fields in one event.
  const set = <K extends keyof AgentForm>(k: K, x: AgentForm[K]) => setV((cur) => ({ ...cur, [k]: x }));
  const engineInfo = h.meta?.engines.find((e) => e.id === v.engine);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{agent ? t('agents.agentSettings') : t('agents.addAgent')}</SheetTitle>
          <SheetDescription>{t('agents.settingsDescription')}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4 pb-6">
          <Field label={t('common.name')}>
            <Input value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('agents.rolePrompt')}>
            <Textarea rows={4} value={v.role} onChange={(e) => set('role', e.target.value)} />
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
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {v.isolation === ISOLATION.custom && (
            <Field label={t('agents.workingDirectory')}>
              <Input value={v.cwd} onChange={(e) => set('cwd', e.target.value)} />
            </Field>
          )}
          <Field label={t('agents.dailyTokenBudget')}>
            <Input
              type="number"
              value={v.dailyTokenBudget}
              onChange={(e) => set('dailyTokenBudget', Number(e.target.value))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.isOrchestrator} onCheckedChange={(x) => set('isOrchestrator', x)} />
            {t('agents.orchestrator')}
          </label>
          {agent && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => h.attempt(() => api.testAgent(agent.id), t('agents.testRunQueued'))}
              >
                {t('agents.testRun')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => h.attempt(() => api.newSession(agent.id), t('agents.newSessionCreated'))}
              >
                {t('agents.newSession')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  h.attempt(() => api.updateAgent(agent.id, { paused: !agent.paused }), t('agents.agentUpdated'))
                }
              >
                {agent.paused ? t('common.resume') : t('common.pause')}
              </Button>
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
      </SheetContent>
    </Sheet>
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
  if (!a) return <div>{t('errors.agentNotFound')}</div>;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => (location.hash = `/${PAGE.agents}`)}>
        {t('agents.title')}
      </Button>
      <PageHeading
        title={a.name}
        subtitle={`${a.engine} · ${a.model || t('common.default')} · ${a.role}`}
        action={
          <Button
            variant="outline"
            onClick={() => h.attempt(() => api.newSession(a.id), t('agents.newSessionCreated'))}
          >
            {t('agents.newSession')}
          </Button>
        }
      />
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
