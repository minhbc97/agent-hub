import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { PAGE, useHub } from '@/lib/hub';
import { api, ROUTING, type Routing } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { ConfirmButton, Field, PageHeading } from '@/components/shared';

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
    routing: Routing;
  }>({
    name: '',
    repoPath: '',
    worktreesDir: '',
    maxConcurrent: 2,
    maxTurnsPerHour: 30,
    turnTimeoutMin: 30,
    maxHops: 8,
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
        routing: ws.settings.routing,
      });
  }, [ws]);
  if (!ws) return null;
  const directPairs = ws.settings.directPairs;
  return (
    <>
      <PageHeading title={t('settings.title')} subtitle={t('settings.description')} />
      <div className="grid max-w-3xl gap-4">
        <Card className="grid gap-4 p-5">
          <h2 className="font-medium">{t('workspace.workspace')}</h2>
          <Field label={t('workspace.name')}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('workspace.repositoryPath')}>
            <Input value={form.repoPath} onChange={(e) => setForm({ ...form, repoPath: e.target.value })} />
          </Field>
          <Field label={t('workspace.worktreeDirectory')}>
            <Input value={form.worktreesDir} onChange={(e) => setForm({ ...form, worktreesDir: e.target.value })} />
          </Field>
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
            {t('workspace.saveWorkspace')}
          </Button>
        </Card>
        <Card className="grid gap-4 p-5">
          <h2 className="font-medium">{t('settings.queue')}</h2>
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
          </div>
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
                    },
                  }),
                t('settings.queueSaved'),
              )
            }
          >
            {t('settings.saveLimits')}
          </Button>
        </Card>
        <Card className="grid gap-4 p-5">
          <h2 className="font-medium">{t('settings.routing')}</h2>
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
                      <label
                        key={pair.join(':')}
                        className="flex items-center gap-2 rounded-sm border px-3 py-2 text-sm"
                      >
                        <Switch
                          size="sm"
                          checked={checked}
                          onCheckedChange={() => {
                            const next = checked ? directPairs.filter((p) => !isPair(p)) : [...directPairs, pair];
                            h.attempt(() =>
                              api.updateWorkspace(ws.id, {
                                settings: { directPairs: next },
                              }),
                            );
                          }}
                        />
                        {a.name} ↔ {b.name}
                      </label>
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
            {t('settings.saveRouting')}
          </Button>
        </Card>
        <Card className="p-5">
          <h2 className="font-medium text-destructive">{t('settings.dangerZone')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('workspace.deleteConfirmation')}</p>
          <ConfirmButton
            className="mt-4"
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
        </Card>
      </div>
    </>
  );
}
