import { EngineSetup } from '@/components/EngineSetup';
import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  FolderGit2,
  Gauge,
  Route,
  Save,
  TerminalSquare,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { PAGE, useHub } from '@/lib/hub';
import { api, ENGINE, ROUTING, type Routing } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ConfirmButton, Field, FolderField, PageHeading, SectionTitle, SwitchField } from '@/components/shared';

export function SettingsPage() {
  const h = useHub();
  const ws = h.ws;
  const [form, setForm] = useState<{
    name: string;
    repoPath: string;
    worktreesDir: string;
    maxConcurrent: number;
    maxTurnsPerHour: number;
    turnTimeoutMin: number;
    maxHops: number;
    quotaPausePercent: number;
    routing: Routing;
  }>({
    name: '',
    repoPath: '',
    worktreesDir: '',
    maxConcurrent: 2,
    maxTurnsPerHour: 30,
    turnTimeoutMin: 30,
    maxHops: 8,
    quotaPausePercent: 100,
    routing: ROUTING.star,
  });
  useEffect(() => {
    if (ws)
      setForm({
        name: ws.name,
        repoPath: ws.repoPath,
        worktreesDir: ws.worktreesDir,
        maxConcurrent: ws.settings.maxConcurrent,
        maxTurnsPerHour: ws.settings.maxTurnsPerHour,
        turnTimeoutMin: ws.settings.turnTimeoutMin,
        maxHops: ws.settings.maxHops,
        quotaPausePercent: ws.settings.quotaPausePercent,
        routing: ws.settings.routing,
      });
  }, [ws]);
  if (!ws) return null;
  const directPairs = ws.settings.directPairs;
  const movesFolders = form.repoPath !== ws.repoPath || form.worktreesDir !== ws.worktreesDir;
  return (
    <>
      <PageHeading title={t('settings.title')} subtitle={t('settings.description')} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <SettingsCard icon={<FolderGit2 />} title={t('workspace.workspace')} description={t('settings.workspaceHint')}>
          <Field label={t('workspace.name')} isRequired>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <FolderField
            label={t('workspace.repositoryPath')}
            value={form.repoPath}
            onChange={(repoPath) => setForm((current) => ({ ...current, repoPath }))}
          />
          <FolderField
            label={t('workspace.worktreeDirectory')}
            value={form.worktreesDir}
            onChange={(worktreesDir) => setForm((current) => ({ ...current, worktreesDir }))}
            placeholder={t('workspace.worktreePlaceholder')}
          />
          {movesFolders && (
            <p className="flex gap-2 rounded-md bg-warning/10 p-3 text-xs/5 text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {t('settings.folderChangeWarning')}
            </p>
          )}
          <Button
            className="w-fit"
            onClick={() =>
              h.attempt(
                () =>
                  api.updateWorkspace(ws.id, {
                    name: form.name,
                    repoPath: form.repoPath,
                    worktreesDir: form.worktreesDir,
                  }),
                t('settings.workspaceSaved'),
              )
            }
          >
            <Save />
            {t('workspace.saveWorkspace')}
          </Button>
        </SettingsCard>
        <SettingsCard icon={<Gauge />} title={t('settings.queue')} description={t('settings.queueHint')}>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('settings.concurrentAgents')}>
              <Input
                type="number"
                min="1"
                value={form.maxConcurrent}
                onChange={(e) => setForm({ ...form, maxConcurrent: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('settings.runsPerHour')}>
              <Input
                type="number"
                min="1"
                value={form.maxTurnsPerHour}
                onChange={(e) => setForm({ ...form, maxTurnsPerHour: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('settings.timeoutMinutes')}>
              <Input
                type="number"
                min="1"
                value={form.turnTimeoutMin}
                onChange={(e) => setForm({ ...form, turnTimeoutMin: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('settings.maxHops')}>
              <Input
                type="number"
                min="1"
                value={form.maxHops}
                onChange={(e) => setForm({ ...form, maxHops: Number(e.target.value) })}
              />
            </Field>
            <Field label={t('settings.quotaPausePercent')}>
              <Input
                type="number"
                min="1"
                max="100"
                value={form.quotaPausePercent}
                onChange={(e) => setForm({ ...form, quotaPausePercent: Number(e.target.value) })}
              />
            </Field>
          </div>
          <p className="text-xs/5 text-muted-foreground">{t('settings.quotaPauseHint')}</p>
          <Button
            className="w-fit"
            onClick={() =>
              h.attempt(
                () =>
                  api.updateWorkspace(ws.id, {
                    settings: {
                      maxConcurrent: form.maxConcurrent,
                      maxTurnsPerHour: form.maxTurnsPerHour,
                      turnTimeoutMin: form.turnTimeoutMin,
                      maxHops: form.maxHops,
                      quotaPausePercent: form.quotaPausePercent,
                    },
                  }),
                t('settings.queueSaved'),
              )
            }
          >
            <Save />
            {t('settings.saveLimits')}
          </Button>
        </SettingsCard>
        <SettingsCard icon={<Route />} title={t('settings.routing')} description={t('settings.routingHint')}>
          <Field label={t('settings.communicationMode')}>
            <Select
              value={form.routing}
              onValueChange={(v) => setForm({ ...form, routing: v === ROUTING.mesh ? ROUTING.mesh : ROUTING.star })}
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="star">{t('agents.starThroughTheOrchestrator')}</SelectItem>
                <SelectItem value="mesh">{t('agents.meshAgentsCanTalkDirectly')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.routing === ROUTING.mesh && (
            <div>
              <div className="mb-2 text-sm">{t('inbox.allowDirectMessages')}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {h.agents.flatMap((a, i) =>
                  h.agents.slice(i + 1).map((b) => {
                    const pair = [a.name, b.name] as [string, string];
                    // Pairs are unordered: a pair saved as [b, a] is the same link.
                    const isPair = (p: [string, string]) => p.includes(a.name) && p.includes(b.name);
                    const checked = directPairs.some(isPair);
                    return (
                      <SwitchField
                        key={pair.join(':')}
                        size="sm"
                        className="rounded-sm border px-3 py-2"
                        checked={checked}
                        onChange={() => {
                          const next = checked ? directPairs.filter((p) => !isPair(p)) : [...directPairs, pair];
                          h.attempt(() => api.updateWorkspace(ws.id, { settings: { directPairs: next } }));
                        }}
                        label={
                          <>
                            {a.name} <ArrowLeftRight className="size-3.5" aria-hidden="true" /> {b.name}
                          </>
                        }
                      />
                    );
                  }),
                )}
              </div>
            </div>
          )}
          <Button
            className="w-fit"
            onClick={() =>
              h.attempt(
                () =>
                  api.updateWorkspace(ws.id, {
                    settings: {
                      routing: form.routing,
                      directPairs,
                    },
                  }),
                t('settings.routingSaved'),
              )
            }
          >
            <Save />
            {t('settings.saveRouting')}
          </Button>
        </SettingsCard>
        <EnginesCard />
        <SettingsCard
          icon={<TriangleAlert />}
          title={t('settings.dangerZone')}
          description={t('workspace.deleteConfirmation')}
          className="ring-destructive/40 [&_h2]:text-destructive"
        >
          <ConfirmButton
            className="w-fit"
            title={t('workspace.deleteWorkspaceTitle', { name: ws.name })}
            description={t('workspace.deleteConfirmation')}
            onConfirm={async () => {
              if (await h.attempt(() => api.deleteWorkspace(ws.id), t('settings.workspaceDeleted')))
                location.hash = `/${PAGE.inbox}`;
            }}
          >
            <Trash2 />
            {t('workspace.deleteWorkspace')}
          </ConfirmButton>
        </SettingsCard>
      </div>
    </>
  );
}

function SettingsCard({
  icon,
  title,
  description,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('grid gap-4 p-5', className)}>
      <header className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4.5">
          {icon}
        </span>
        <div>
          <SectionTitle>{title}</SectionTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>
      {children}
    </Card>
  );
}

/** Which agent CLIs this computer can run; the same PATH check the agent form warns with. */
function EnginesCard() {
  const h = useHub();
  return (
    <SettingsCard icon={<TerminalSquare />} title={t('settings.engines')} description={t('settings.enginesHint')}>
      <ul className="grid gap-2">
        {(h.meta?.engines ?? []).map((engine) => (
          <li key={engine.id} className="grid gap-1.5 rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
              {engine.id === ENGINE.openrouter ? (
                engine.configured ? (
                  <CircleCheck className="size-4 text-success" />
                ) : (
                  <CircleHelp className="size-4 text-warning" />
                )
              ) : engine.installed === true ? (
                <CircleCheck className="size-4 text-success" />
              ) : engine.installed === false ? (
                <CircleX className="size-4 text-destructive" />
              ) : (
                <CircleHelp className="size-4 text-muted-foreground" />
              )}
              <span className="font-medium">{engine.label}</span>
              {!engine.supported && <Badge variant="outline">{t('settings.notSupportedYet')}</Badge>}
              {engine.defaultCommand && (
                <code className="ml-auto text-xs text-muted-foreground">{engine.defaultCommand}</code>
              )}
              <span className="w-32 text-right text-xs text-muted-foreground">
                {engine.id === ENGINE.openrouter
                  ? t(engine.configured ? 'settings.apiKeyConfigured' : 'settings.apiKeyMissing')
                  : engine.installed === true
                    ? t('settings.installed')
                    : engine.installed === false
                      ? t('settings.notOnPath')
                      : t('settings.unknown')}
              </span>
            </div>
            <EngineSetup engine={engine} />
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
