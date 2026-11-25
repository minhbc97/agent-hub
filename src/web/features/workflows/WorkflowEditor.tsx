import { useState } from 'react';
import { ArrowDown, ArrowUp, CalendarSearch, Plus, Save, Trash2, X } from 'lucide-react';
import { useHub } from '@/lib/hub';
import { api, TRIGGER_KIND, USER_ID, type WorkflowInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { i18n, t } from '@/lib/i18n';
import { ConfirmButton, Field, PageHeading, SectionTitle, SwitchField, uid } from '@/components/shared';

type Step = WorkflowInput['steps'][number];
type Trigger = WorkflowInput['trigger'];

/** Edits one workflow: its steps (who does what, in order) and what starts it. */
export function WorkflowEditor({
  id,
  initial,
  close,
}: {
  id: string | null;
  initial: WorkflowInput;
  close: () => void;
}) {
  const h = useHub();
  const [form, setForm] = useState(initial);
  const [preview, setPreview] = useState<string[]>([]);

  const setSteps = (steps: Step[]) => setForm((f) => ({ ...f, steps }));
  const changeStep = (i: number, patch: Partial<Step>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)) }));
  const moveStep = (from: number, to: number) => {
    const steps = [...form.steps];
    [steps[from], steps[to]] = [steps[to]!, steps[from]!];
    setSteps(steps);
  };
  const changeTrigger = (patch: Partial<Trigger>) => setForm((f) => ({ ...f, trigger: { ...f.trigger, ...patch } }));

  const save = async () => {
    if (!h.ws) return;
    const saved = id
      ? await h.attempt(() => api.updateWorkflow(id, form), t('workflows.workflowSaved'))
      : await h.attempt(() => api.createWorkflow(h.ws!.id, form), t('workflows.workflowCreated'));
    if (saved) close();
  };

  return (
    <div className="-mx-7 -mt-7 flex min-h-[calc(100vh-4.5rem)] flex-1 flex-col">
      <PageHeading
        variant="bar"
        title={id ? form.name : t('workflows.newWorkflow')}
        subtitle={t('workflows.editorDescription')}
        back={{ label: t('common.backToList'), onClick: close }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4">
            <Card className="grid gap-3 p-4">
              <Field label={t('workflows.name')} isRequired>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('common.description')}>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                />
              </Field>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <SectionTitle>{t('workflows.steps')}</SectionTitle>
                  <p className="text-xs text-muted-foreground">{t('workflows.stepsDescription')}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSteps([
                      ...form.steps,
                      {
                        id: uid(),
                        name: t('workflows.stepName', { number: form.steps.length + 1 }),
                        agentId: null,
                        instruction: '',
                        approval: false,
                        onReject: null,
                      },
                    ])
                  }
                >
                  <Plus />
                  {t('workflows.addStep')}
                </Button>
              </div>
              <div className="space-y-3">
                {form.steps.map((s, i) => (
                  <div key={s.id} className="rounded-lg border p-3">
                    <div className="mb-3 flex items-center gap-2">
                      <Badge variant="secondary">{i + 1}</Badge>
                      <Input
                        required
                        value={s.name}
                        aria-label={t('workflows.stepName', { number: i + 1 })}
                        onChange={(e) => changeStep(i, { name: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('workflows.moveStepUp')}
                        disabled={i === 0}
                        onClick={() => moveStep(i, i - 1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('workflows.moveStepDown')}
                        disabled={i === form.steps.length - 1}
                        onClick={() => moveStep(i, i + 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('workflows.removeStep')}
                        disabled={form.steps.length < 2}
                        onClick={() => setSteps(form.steps.filter((_, n) => n !== i))}
                      >
                        <X />
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label={t('tasks.assignee')}>
                        <Select
                          value={s.agentId || USER_ID}
                          onValueChange={(v) => changeStep(i, { agentId: v === USER_ID ? null : v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={USER_ID}>{t('common.you')}</SelectItem>
                            {h.agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={t('workflows.instructions')}>
                        <Textarea
                          rows={2}
                          value={s.instruction}
                          onChange={(e) => changeStep(i, { instruction: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <SwitchField
                        label={t('inbox.needsYourReview')}
                        checked={s.approval}
                        onChange={(v) => changeStep(i, { approval: v })}
                      />
                      {s.approval && (
                        <Select value={s.onReject || s.id} onValueChange={(v) => changeStep(i, { onReject: v })}>
                          <SelectTrigger className="w-52" aria-label={t('workflows.returnToStepIfRejected')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {form.steps.slice(0, i + 1).map((x) => (
                              <SelectItem key={x.id} value={x.id}>
                                {x.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <aside className="grid content-start gap-4 lg:sticky lg:top-5 lg:self-start">
            <Card className="grid gap-3 p-4">
              <SectionTitle>{t('workflows.trigger')}</SectionTitle>
              <Field label={t('workflows.mode')}>
                <Select
                  value={form.trigger.kind}
                  onValueChange={(v) =>
                    changeTrigger({ kind: v === TRIGGER_KIND.schedule ? TRIGGER_KIND.schedule : TRIGGER_KIND.manual })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">{t('workflows.manual')}</SelectItem>
                    <SelectItem value="schedule">{t('workflows.scheduled')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.trigger.kind === TRIGGER_KIND.schedule && (
                <>
                  <Field label={t('workflows.scheduleFiveFieldCron')} isRequired>
                    <Input
                      required
                      value={form.trigger.cron}
                      onChange={(e) => changeTrigger({ cron: e.target.value })}
                    />
                  </Field>
                  <p className="text-xs text-muted-foreground">{t('workflows.cronExample')}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () =>
                      setPreview((await h.attempt(() => api.cronPreview(form.trigger.cron)))?.next ?? [])
                    }
                  >
                    <CalendarSearch />
                    {t('workflows.previewNextRuns')}
                  </Button>
                  {preview.map((v) => (
                    <div className="text-xs text-muted-foreground" key={v}>
                      {new Date(v).toLocaleString(i18n.resolvedLanguage || 'en')}
                    </div>
                  ))}
                </>
              )}
              <Field label={t('workflows.taskTitleSupportsDate')}>
                <Input value={form.trigger.title} onChange={(e) => changeTrigger({ title: e.target.value })} />
              </Field>
              <Field label={t('workflows.defaultContext')}>
                <Textarea
                  rows={3}
                  value={form.trigger.body}
                  onChange={(e) => changeTrigger({ body: e.target.value })}
                />
              </Field>
              <SwitchField
                label={t('workflows.enabled')}
                checked={form.enabled}
                onChange={(v) => setForm({ ...form, enabled: v })}
              />
            </Card>
          </aside>
        </div>
      </div>
      <footer className="sticky bottom-0 z-20 flex shrink-0 items-center justify-between gap-3 border-t bg-background/95 px-7 py-3 backdrop-blur-sm">
        {id ? (
          <ConfirmButton
            title={t('workflows.deleteWorkflowTitle', { name: form.name })}
            description={t('workflows.deleteWorkflowDescription')}
            onConfirm={async () => {
              if (await h.attempt(() => api.deleteWorkflow(id), t('workflows.workflowDeleted'))) close();
            }}
          >
            <Trash2 />
            {t('workflows.deleteWorkflow')}
          </ConfirmButton>
        ) : (
          <span />
        )}
        <Button disabled={!form.name.trim() || !form.steps.length} onClick={save}>
          <Save />
          {t('workflows.saveWorkflow')}
        </Button>
      </footer>
    </div>
  );
}
