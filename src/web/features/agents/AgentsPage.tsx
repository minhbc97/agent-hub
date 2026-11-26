import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Check,
  ChevronsUpDown,
  History,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Square,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { PAGE, useHub, agentState } from '@/lib/hub';
import { qk } from '@/lib/query';
import {
  AGENT_STATUS,
  api,
  DEFAULT_CONTEXT_LIMIT,
  ENGINE,
  FALLBACK_ENGINES,
  ISOLATION,
  ISOLATIONS,
  RESET_POLICIES,
  RESET_POLICY,
  RUN_STATUS,
  workTokens,
  type Agent,
  type EngineInfo,
  type TokenTotal,
} from '@/lib/api';
import { WorkspaceMenu } from '@/components/WorkspaceMenu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { i18n, t } from '@/lib/i18n';
import { AgentMap } from './AgentMap';
import { McpServerDialog } from './McpServerDialog';
import { AgentTips } from '@/features/guide/AgentTips';
import { Markdown } from '@/components/Markdown';
import { AgentTerminal } from '@/components/AgentTerminal';
import { EngineSetup } from '@/components/EngineSetup';
import { COACHMARK, Coachmark } from '@/components/Coachmark';
import {
  Avatar,
  Caption,
  ConfirmButton,
  Empty,
  Field,
  FolderField,
  PageHeading,
  SectionTitle,
  statusDot,
} from '@/components/shared';

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
            <Plus />
            {t('agents.addAgent')}
          </Button>
        }
      />
      {h.agents.length === 0 ? (
        <Empty icon={<Bot />} title={t('agents.noAgentsYet')} body={t('agents.addFirstAgentDescription')} />
      ) : (
        <>
          <AgentMap />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {h.agents.map((a) => (
              <Card key={a.id} className="relative gap-0 p-4 transition-colors hover:bg-accent/40">
                <div className="flex items-center gap-3">
                  <Avatar agent={a} size={40} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {/* The link covers the whole card; the buttons below sit above it. */}
                      <a
                        href={`#/${PAGE.agents}/${a.id}`}
                        className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
                      >
                        {a.name}
                      </a>{' '}
                      {a.isOrchestrator && <Badge variant="secondary">{t('agents.orchestrator')}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{engineLine(a)}</div>
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
                <div className="relative z-10 mt-3 flex gap-2">
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
        </>
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
  | 'resetPolicy'
  | 'resetValue'
  | 'isLean'
  | 'mcpServers'
  | 'allowedCommands'
  | 'fallbackEngine'
  | 'fallbackModel'
>;

// Tints are agent data (stored as hex and drawn as the avatar background), not theme colors.
// Light pastels ordered by hue, so the face stays readable; the first is the default for new agents.
const AVATAR_TINTS = [
  '#f6bf1d',
  '#fde047',
  '#bef264',
  '#86efac',
  '#6ee7b7',
  '#9fd3c7',
  '#5eead4',
  '#67e8f9',
  '#7dd3fc',
  '#93c5fd',
  '#a5b4fc',
  '#c4b5fd',
  '#d8b4fe',
  '#f0abfc',
  '#f9a8d4',
  '#fda4af',
  '#fca5a5',
  '#f4a28c',
  '#fdba74',
  '#d6d3d1',
] as const;
// A fixed set keeps the picker stable: choosing a face never reorders or replaces the options.
const AVATAR_SEEDS = [
  'Ada',
  'Bao',
  'Chi',
  'Dante',
  'Eun',
  'Femi',
  'Gia',
  'Hugo',
  'Iris',
  'Jun',
  'Kai',
  'Lena',
  'Mai',
  'Nico',
  'Omar',
  'Priya',
  'Quinn',
  'Rosa',
  'Sven',
  'Tala',
  'Uma',
  'Vik',
  'Wren',
  'Yara',
] as const;
const DEFAULT_RESET_TURNS = 20;
/** Select items cannot carry an empty value. */
const NO_FALLBACK = 'none';

/** While its own engine is out of quota the agent runs on its fallback; say so wherever its engine shows. */
function engineLine(a: Agent): string {
  const own = `${a.engine} · ${a.model || t('common.default')}`;
  return a.activeEngine ? t('agents.onFallback', { own, fallback: a.activeEngine }) : own;
}
const randomAvatarSeed = () => AVATAR_SEEDS[Math.floor(Math.random() * AVATAR_SEEDS.length)];

/** New agents start on Claude with that engine's defaults (e.g. edits allowed, since headless turns cannot ask). */
function formValues(agent: Agent | null, claude: EngineInfo | undefined, isLeadAgent: boolean): AgentForm {
  return {
    name: agent?.name ?? '',
    avatarSeed: agent ? agent.avatarSeed || agent.name : randomAvatarSeed(),
    tint: agent?.tint ?? AVATAR_TINTS[0],
    role: agent?.role ?? '',
    goal: agent?.goal ?? '',
    engine: agent?.engine ?? ENGINE.claude,
    model: agent?.model ?? '',
    command: agent?.command ?? claude?.defaultCommand ?? '',
    extraArgs: agent?.extraArgs ?? claude?.defaultExtraArgs ?? '',
    isolation: agent?.isolation ?? (agent?.engine === ENGINE.openrouter ? ISOLATION.shared : ISOLATION.worktree),
    cwd: agent?.cwd ?? '',
    isOrchestrator: agent?.isOrchestrator ?? isLeadAgent,
    resetPolicy: agent?.resetPolicy ?? RESET_POLICY.context,
    resetValue: agent?.resetValue ?? DEFAULT_CONTEXT_LIMIT,
    isLean: agent?.isLean ?? false,
    mcpServers: agent?.mcpServers ?? [],
    allowedCommands: agent?.allowedCommands ?? [],
    fallbackEngine: agent?.fallbackEngine ?? null,
    fallbackModel: agent?.fallbackModel ?? '',
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
  // null until known. Git is only needed for worktree isolation; offices that are not code use the shared folder.
  const [isAddingMcp, setIsAddingMcp] = useState(false);
  const wsId = h.ws?.id;
  const workspaceGitQuery = useQuery({
    queryKey: qk.workspaceGit(wsId ?? ''),
    queryFn: () => api.workspaceGit(wsId ?? ''),
    enabled: open && !!wsId,
    staleTime: Infinity,
  });
  useEffect(() => {
    const hasGit = workspaceGitQuery.data?.hasGit;
    if (!open || agent || hasGit === undefined) return;
    // Only a new agent's default follows the folder; an existing agent keeps what it was saved with.
    setV((cur) => ({ ...cur, isolation: hasGit ? ISOLATION.worktree : ISOLATION.shared }));
  }, [open, agent, workspaceGitQuery.data]);
  const hasGit = workspaceGitQuery.data?.hasGit ?? null;
  const suggestedIsolation = hasGit === false ? ISOLATION.shared : ISOLATION.worktree;
  const engineInfo = h.meta?.engines.find((e) => e.id === v.engine);
  // OpenRouter and custom commands keep no session, so there is nothing to rotate.
  const hasSessions = v.engine !== ENGINE.openrouter && v.engine !== ENGINE.custom;
  const fallbackChoices = (h.meta?.engines ?? []).filter(
    (e) => e.id !== v.engine && e.supported && e.installed !== false && FALLBACK_ENGINES.includes(e.id),
  );
  // A saved server that is no longer installed stays visible so it can be unpicked.
  const mcpInstalled = v.engine === ENGINE.codex ? h.meta?.codexMcpServers : h.meta?.claudeMcpServers;
  const mcpChoices = [...new Set([...(mcpInstalled ?? []), ...v.mcpServers])];
  const hasMcpPicker = v.engine === ENGINE.claude || v.engine === ENGINE.codex;
  const isLeanClaude = v.engine === ENGINE.claude && v.isLean;
  const fields = (
    <div className="grid gap-4 px-6 py-5">
      <Field label={t('common.name')} isRequired>
        <Input required value={v.name} onChange={(e) => set('name', e.target.value)} />
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
              if (info.id === ENGINE.openrouter) set('isolation', ISOLATION.shared);
              else if (v.engine === ENGINE.openrouter) set('isolation', suggestedIsolation);
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
        <Field label={t('agents.model')} isRequired={v.engine === ENGINE.openrouter}>
          <ModelPicker engine={engineInfo} value={v.model} onChange={(x) => set('model', x)} />
        </Field>
      </div>
      {v.engine === ENGINE.openrouter && (
        <p className="-mt-2 text-xs text-muted-foreground">{t('agents.openRouterSetupHint')}</p>
      )}
      {engineInfo && <EngineSetup engine={engineInfo} className="-mt-2" />}
      {FALLBACK_ENGINES.includes(v.engine) && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('agents.fallbackEngine')}>
            <Select
              value={v.fallbackEngine ?? NO_FALLBACK}
              onValueChange={(x) => {
                set('fallbackEngine', FALLBACK_ENGINES.find((e) => e === x) ?? null);
                // A model id from another engine would make the fallback CLI fail at start.
                set('fallbackModel', '');
              }}
            >
              <Coachmark id={COACHMARK.fallbackEngine} side="top">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </Coachmark>
              <SelectContent>
                <SelectItem value={NO_FALLBACK}>{t('agents.noFallback')}</SelectItem>
                {fallbackChoices.map((engine) => (
                  <SelectItem key={engine.id} value={engine.id}>
                    {engine.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {v.fallbackEngine && (
            <Field label={t('agents.fallbackModel')}>
              <ModelPicker
                engine={h.meta?.engines.find((e) => e.id === v.fallbackEngine)}
                value={v.fallbackModel}
                onChange={(x) => set('fallbackModel', x)}
              />
            </Field>
          )}
        </div>
      )}
      {FALLBACK_ENGINES.includes(v.engine) && (
        <p className="-mt-2 text-xs/5 text-muted-foreground">{t('agents.fallbackEngineHint')}</p>
      )}
      {v.engine !== ENGINE.openrouter && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('agents.command')} isRequired={v.engine === ENGINE.custom}>
            <Input
              required={v.engine === ENGINE.custom}
              value={v.command}
              onChange={(e) => set('command', e.target.value)}
            />
          </Field>
          <Field label={t('agents.extraArguments')}>
            <Input value={v.extraArgs} onChange={(e) => set('extraArgs', e.target.value)} />
          </Field>
        </div>
      )}
      {v.engine !== ENGINE.openrouter && (
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
                <SelectItem key={x} value={x} disabled={x === ISOLATION.worktree && hasGit === false}>
                  {t(`agents.isolationMode.${x}`)}
                  {x === ISOLATION.worktree && hasGit === false && (
                    <span className="text-muted-foreground">{t('agents.needsGit')}</span>
                  )}
                  {x === suggestedIsolation && <span className="text-muted-foreground">{t('agents.recommended')}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {v.engine !== ENGINE.openrouter && (
        <p className="-mt-2 text-xs/5 text-muted-foreground">{t(`agents.isolationHint.${v.isolation}`)}</p>
      )}
      {v.engine !== ENGINE.openrouter && v.isolation === ISOLATION.custom && (
        <FolderField
          isRequired
          label={t('agents.workingDirectory')}
          value={v.cwd}
          onChange={(path) => set('cwd', path)}
        />
      )}
      {hasSessions && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('agents.resetPolicy')}>
            <Select
              value={v.resetPolicy}
              onValueChange={(x) => {
                const policy = RESET_POLICIES.find((p) => p === x);
                if (!policy) return;
                set('resetPolicy', policy);
                set('resetValue', policy === RESET_POLICY.context ? DEFAULT_CONTEXT_LIMIT : DEFAULT_RESET_TURNS);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESET_POLICIES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`agents.resetPolicyMode.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {v.resetPolicy !== RESET_POLICY.never && (
            <Field label={t(`agents.resetValueLabel.${v.resetPolicy}`)}>
              <Input
                type="number"
                min={1}
                step={v.resetPolicy === RESET_POLICY.context ? 10_000 : 1}
                value={v.resetValue}
                onChange={(e) => set('resetValue', Math.max(0, Math.round(Number(e.target.value) || 0)))}
              />
            </Field>
          )}
        </div>
      )}
      {hasSessions && <p className="-mt-2 text-xs/5 text-muted-foreground">{t('agents.resetPolicyHint')}</p>}
      {(v.engine === ENGINE.claude || v.fallbackEngine === ENGINE.claude) && (
        <>
          <Field label={t('agents.allowedCommands')}>
            <Textarea
              rows={3}
              placeholder={'npm test\ngit add\ngit commit'}
              value={v.allowedCommands.join('\n')}
              onChange={(e) => set('allowedCommands', e.target.value.split('\n'))}
            />
          </Field>
          <p className="-mt-2 text-xs/5 text-muted-foreground">{t('agents.allowedCommandsHint')}</p>
        </>
      )}
      {v.engine === ENGINE.claude && (
        <div className="grid gap-1.5">
          <Coachmark id={COACHMARK.leanMode} side="top">
            <Label className="flex w-fit items-center gap-2 font-normal">
              <Switch checked={v.isLean} onCheckedChange={(x) => set('isLean', x)} />
              {t('agents.leanMode')}
            </Label>
          </Coachmark>
          <p className="text-xs/5 text-muted-foreground">{t('agents.leanModeHint')}</p>
        </div>
      )}
      {hasMcpPicker && (
        <Field label={t(isLeanClaude ? 'agents.leanMcpServers' : 'agents.mcpServers')}>
          {mcpChoices.length ? (
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              className="flex-wrap justify-start"
              value={v.mcpServers}
              onValueChange={(x) => set('mcpServers', x)}
            >
              {mcpChoices.map((name) => (
                <ToggleGroupItem key={name} value={name}>
                  {v.mcpServers.includes(name) && <Check />}
                  {name.replace(/^plugin:/, '')}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(v.engine === ENGINE.codex ? 'agents.noCodexMcpServers' : 'agents.noMcpServers')}
            </p>
          )}
        </Field>
      )}
      {hasMcpPicker && !isLeanClaude && (
        <p className="-mt-2 text-xs/5 text-muted-foreground">
          {t(v.engine === ENGINE.codex ? 'agents.codexMcpServersHint' : 'agents.mcpServersHint')}
        </p>
      )}
      {hasMcpPicker && (
        <div className="-mt-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setIsAddingMcp(true)}>
            <Plus />
            {t('agents.addMcpServer')}
          </Button>
          {isAddingMcp && (
            <McpServerDialog
              open
              engine={v.engine}
              onOpenChange={setIsAddingMcp}
              onAdded={(name, engines) => {
                if (engines.includes(v.engine)) set('mcpServers', [...new Set([...v.mcpServers, name])]);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
  // Pinned under the scrolling fields, so saving never needs a scroll to the bottom of a long form.
  const footer = (
    <div className="grid shrink-0 gap-3 border-t px-6 py-4">
      {agent && (
        <div className="flex flex-wrap gap-2">
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
        disabled={
          !v.name.trim() || engineInfo?.supported === false || (v.engine === ENGINE.openrouter && !v.model.trim())
        }
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
  const body = <div className="min-h-0 flex-1 overflow-y-auto">{fields}</div>;
  if (isLeadAgent) {
    return (
      <Dialog open={open}>
        <DialogContent
          className="flex max-h-[calc(100vh-3rem)] flex-col gap-0 p-0 sm:max-w-4xl"
          showCloseButton={false}
        >
          <DialogHeader className="shrink-0 border-b px-6 py-5">
            {/* The dialog cannot be closed, so it must offer the way to another workspace itself. */}
            {h.workspaces.length > 1 && (
              <div className="mb-2">
                <WorkspaceMenu />
              </div>
            )}
            <DialogTitle className="text-2xl font-semibold">{t('agents.createLeadAgent')}</DialogTitle>
            <DialogDescription>{t('agents.firstAgentDescription')}</DialogDescription>
          </DialogHeader>
          {body}
          {footer}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b px-6 py-4">
          <SheetTitle>{agent ? t('agents.agentSettings') : t('agents.addAgent')}</SheetTitle>
          <SheetDescription>{t('agents.settingsDescription')}</SheetDescription>
        </SheetHeader>
        {body}
        {footer}
      </SheetContent>
    </Sheet>
  );
}

/** Pick a face from the fixed set and a background tint. */
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
  // Older agents may use a seed outside the set; keep it as the first option so it stays selectable.
  const choices: readonly string[] = AVATAR_SEEDS.some((s) => s === seed) ? AVATAR_SEEDS : [seed, ...AVATAR_SEEDS];
  const selectedRing = 'ring-2 ring-primary ring-offset-2 ring-offset-card';
  return (
    <div className="@container grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{t('agents.avatar')}</span>
      <div className="flex flex-col gap-5 rounded-lg border bg-card p-4 @md:flex-row @md:items-center">
        <div className="self-center">
          <Avatar agent={{ name, avatarSeed: seed, tint }} size={80} />
        </div>
        <div className="@container grid min-w-0 flex-1 gap-4">
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t('agents.avatarFace')}</span>
            <div className="flex flex-wrap gap-2">
              {choices.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  variant="ghost"
                  aria-label={t('agents.chooseAvatar')}
                  aria-pressed={choice === seed}
                  onClick={() => onSeedChange(choice)}
                  className={cn(
                    'size-auto rounded-full p-0 opacity-70 hover:bg-transparent hover:opacity-100',
                    choice === seed && cn('opacity-100', selectedRing),
                  )}
                >
                  <Avatar agent={{ name, avatarSeed: choice, tint }} size={40} />
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t('agents.avatarBackground')}</span>
            <div className="grid w-fit grid-cols-5 gap-2 @sm:grid-cols-10">
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
                  className={cn('rounded-full border-foreground/10', color === tint && selectedRing)}
                >
                  {color === tint && <Check className="rounded-full bg-background/80 p-0.5 text-foreground" />}
                </Button>
              ))}
            </div>
          </div>
        </div>
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
            {value
              ? (models.find((m) => m.id === value)?.label ?? value)
              : engine?.id === ENGINE.openrouter
                ? t('agents.openRouterModelPlaceholder')
                : t('agents.cliDefault')}
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

const RUN_DOT = {
  [RUN_STATUS.running]: 'bg-info',
  [RUN_STATUS.ok]: 'bg-success',
  [RUN_STATUS.failed]: 'bg-destructive',
} as const;
const TAB = { overview: 'overview', terminal: 'terminal' } as const;

export function AgentDetail({ id }: { id: string }) {
  const h = useHub();
  const a = h.agentById(id);
  const runsQuery = useQuery({
    queryKey: qk.runs(h.ws?.id ?? '', id),
    queryFn: () => api.runs(id),
    enabled: !!h.ws,
    staleTime: Infinity,
  });
  const runs = runsQuery.data ?? [];
  const [isEditing, setEditing] = useState(false);
  const [tab, setTab] = useState<string>(TAB.overview);
  if (!a) return <div>{t('errors.agentNotFound')}</div>;
  const state = agentState(a, h.messages);
  const stats = [
    { label: t('agents.session'), value: a.sessionId ? t('agents.sessionConnected') : t('agents.noSession') },
    { label: t('agents.tokensTodayLabel'), value: tokensTodayOf(h.tokens, a.id).toLocaleString() },
    { label: t('agents.recentCost'), value: `$${runs.reduce((sum, r) => sum + r.costUsd, 0).toFixed(4)}` },
  ];
  return (
    <>
      <PageHeading
        title={a.name}
        subtitle={`${engineLine(a)} · ${t(`agents.isolationMode.${a.isolation}`)}`}
        back={{ label: t('agents.backToAgents'), onClick: () => (location.hash = `/${PAGE.agents}`) }}
        media={<Avatar agent={a} size={48} />}
        badges={
          <>
            {a.isOrchestrator && <Badge variant="secondary">{t('agents.orchestrator')}</Badge>}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('size-2 rounded-full', statusDot[state])} />
              {t(`agents.state.${state}`)}
            </span>
          </>
        }
        action={
          <>
            {a.status === AGENT_STATUS.working && (
              <Button
                variant="destructive"
                onClick={() => h.attempt(() => api.stopAgent(a.id), t('agents.turnStopped'))}
              >
                <Square />
                {t('agents.stopTurn')}
              </Button>
            )}
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
          </>
        }
      />
      <AgentEditor open={isEditing} close={() => setEditing(false)} agent={a} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value={TAB.overview}>{t('agents.overview')}</TabsTrigger>
          <TabsTrigger value={TAB.terminal}>
            <SquareTerminal />
            {t('agents.terminal.title')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value={TAB.overview}>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <Card className="col-span-2 grid grid-cols-2 gap-6 p-5">
              <div className="min-w-0">
                <Caption>{t('agents.role')}</Caption>
                <p
                  className={cn('mt-1.5 line-clamp-6 text-sm whitespace-pre-wrap', !a.role && 'text-muted-foreground')}
                >
                  {a.role || t('agents.noRoleDescription')}
                </p>
              </div>
              <div className="min-w-0">
                <Caption>{t('agents.goal')}</Caption>
                <p
                  className={cn('mt-1.5 line-clamp-6 text-sm whitespace-pre-wrap', !a.goal && 'text-muted-foreground')}
                >
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
          <AgentTips agent={a} onConfigure={() => setEditing(true)} />
          {a.handoff && (
            <Card className="mb-6 gap-0 p-5">
              <Caption>{t('agents.handoffNote')}</Caption>
              <Markdown text={a.handoff} className="mt-1.5 text-sm/6" />
            </Card>
          )}
          <SectionTitle className="mb-3">{t('agents.runHistory')}</SectionTitle>
          <Card className="gap-0 p-0">
            <div className="grid grid-cols-[1.5fr_repeat(6,100px)] gap-2 bg-muted/40 p-3 text-xs text-muted-foreground">
              <span>{t('agents.runs')}</span>
              <span>{t('agents.input')}</span>
              <span>{t('agents.output')}</span>
              <span>{t('agents.cacheWrites')}</span>
              <span>{t('agents.cacheReads')}</span>
              <span>{t('agents.context')}</span>
              <span>{t('agents.cost')}</span>
            </div>
            {runs.length ? (
              runs.map((r) => (
                <Collapsible key={r.id} className="border-t">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="grid h-auto w-full grid-cols-[1.5fr_repeat(6,100px)] justify-items-start gap-2 rounded-none p-3 font-normal tabular-nums"
                    >
                      <span className="flex items-center gap-2">
                        <span className={cn('size-2 rounded-full', RUN_DOT[r.status])} />
                        {new Date(r.startedAt).toLocaleString(i18n.resolvedLanguage || 'en')}
                        <span className="text-muted-foreground">{t(`agents.runStatus.${r.status}`)}</span>
                      </span>
                      <span>{r.inputTokens}</span>
                      <span>{r.outputTokens}</span>
                      <span>{r.cacheWriteTokens}</span>
                      <span>{r.cacheReadTokens}</span>
                      <span>{r.contextTokens || ''}</span>
                      <span>${r.costUsd.toFixed(4)}</span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mx-3 mb-3 max-h-96 overflow-auto rounded-sm bg-muted p-3 text-xs whitespace-pre-wrap">
                      {r.output}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              ))
            ) : (
              <p className="p-5 text-sm text-muted-foreground">{t('agents.noRuns')}</p>
            )}
          </Card>
        </TabsContent>
        <TabsContent value={TAB.terminal}>
          <Card className="h-[calc(100vh-18rem)] min-h-80 gap-0 overflow-hidden p-0">
            <AgentTerminal key={a.id} agent={a} />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
