import { Fragment, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  Clock3,
  Code,
  PenLine,
  Pencil,
  Play,
  Plus,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { useHub } from '@/lib/hub';
import { api, TRIGGER_KIND, type Workflow, type WorkflowInput } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { i18n, t } from '@/lib/i18n';
import { Empty, PageHeading, uid } from '@/components/shared';
import { WorkflowEditor } from './WorkflowEditor';

function createWorkflowTemplates() {
  return [
    {
      name: t('workflows.writeArticle'),
      description: t('workflows.articleDescription'),
      steps: [t('workflows.research'), t('workflows.writeDraft'), t('common.edit'), t('workflows.publish')],
      approval: 2,
      icon: PenLine,
    },
    {
      name: t('workflows.recurringReport'),
      description: t('workflows.recurringReportDescription'),
      steps: [t('workflows.collectData'), t('workflows.writeReport'), t('workflows.reviewReport')],
      approval: 2,
      cron: '0 9 * * 1',
      icon: CalendarClock,
    },
    {
      name: t('workflows.ticketDev'),
      description: t('workflows.ticketDevDescription'),
      steps: [
        t('workflows.clarifyRequirements'),
        t('workflows.implement'),
        t('workflows.testStep'),
        t('workflows.pmApproval'),
      ],
      approval: 3,
      icon: Code,
    },
  ];
}

type WorkflowTemplate = ReturnType<typeof createWorkflowTemplates>[number];

/** Form values for a new workflow: blank, or prefilled from a template. */
function draftWorkflow(agentIds: string[], template?: WorkflowTemplate): WorkflowInput {
  if (!template) {
    return {
      name: '',
      description: '',
      steps: [
        {
          id: uid(),
          name: t('workflows.step1'),
          agentId: agentIds[0] ?? null,
          instruction: '',
          approval: false,
          onReject: null,
        },
      ],
      trigger: {
        kind: TRIGGER_KIND.manual,
        cron: '0 9 * * 1',
        title: t('tasks.dateTitle', { date: '{date}' }),
        body: '',
      },
      enabled: true,
    };
  }
  return {
    name: template.name,
    description: template.description,
    steps: template.steps.map((name, i) => ({
      id: uid(),
      name,
      agentId: agentIds[i] ?? null,
      instruction: t('workflows.completedStep', { name }),
      approval: i + 1 === template.approval,
      onReject: null,
    })),
    trigger: {
      kind: template.cron ? TRIGGER_KIND.schedule : TRIGGER_KIND.manual,
      cron: template.cron || '0 9 * * 1',
      title: `${template.name} · {date}`,
      body: '',
    },
    enabled: true,
  };
}

export function WorkflowsPage() {
  const h = useHub();
  const [editing, setEditing] = useState<{ id: string | null; initial: WorkflowInput } | null>(null);
  const agentIds = h.agents.map((a) => a.id);
  const init = (w?: Workflow, template?: WorkflowTemplate) =>
    setEditing(
      w
        ? {
            id: w.id,
            initial: {
              name: w.name,
              description: w.description,
              steps: w.steps,
              trigger: w.trigger,
              enabled: w.enabled,
            },
          }
        : { id: null, initial: draftWorkflow(agentIds, template) },
    );
  if (editing) return <WorkflowEditor id={editing.id} initial={editing.initial} close={() => setEditing(null)} />;
  return (
    <>
      <PageHeading
        title={t('workflows.title')}
        subtitle={t('workflows.description')}
        action={
          <Button onClick={() => init()}>
            <Plus />
            {t('workflows.newWorkflow')}
          </Button>
        }
      />
      <h2 className="mb-3 font-medium">{t('workflows.startFromATemplate')}</h2>
      <div className="mb-7 grid gap-3 md:grid-cols-3">
        {createWorkflowTemplates().map((x) => (
          <Card key={x.name} className="p-4">
            <div className="mb-3 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <x.icon size={17} />
            </div>
            <div className="font-medium">{x.name}</div>
            <p className="mt-1 min-h-10 text-sm text-muted-foreground">{x.description}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => init(undefined, x)}>
              {t('workflows.useTemplate')}
            </Button>
          </Card>
        ))}
      </div>
      <h2 className="mb-3 font-medium">
        {t('workflows.yourWorkflows')} <span className="text-muted-foreground">{h.workflows.length}</span>
      </h2>
      {h.workflows.length === 0 ? (
        <Empty icon={<WorkflowIcon />} title={t('workflows.noWorkflowsYet')} body={t('workflows.emptyDescription')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {h.workflows.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex justify-between gap-2">
                <div>
                  <div className="font-medium">{w.name}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{w.description}</p>
                </div>
                <Badge variant={w.enabled ? 'secondary' : 'outline'}>
                  {w.enabled ? t('workflows.enabled') : t('workflows.disabled')}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {w.steps.map((step, index) => (
                  <Fragment key={step.id}>
                    {index > 0 && <ArrowRight size={12} aria-hidden="true" />}
                    <span>{step.name}</span>
                  </Fragment>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t pt-3">
                <span className="text-xs text-muted-foreground">
                  <Clock3 size={13} className="mr-1 inline" />
                  {w.trigger.kind === TRIGGER_KIND.manual ? t('workflows.manual') : w.trigger.cron}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => init(w)}>
                    <Pencil />
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      h.attempt(
                        () =>
                          api.runWorkflow(
                            w.id,
                            w.trigger.title.replace(
                              '{date}',
                              new Date().toLocaleDateString(i18n.resolvedLanguage || 'vi'),
                            ),
                            w.trigger.body,
                          ),
                        t('workflows.workflowStarted'),
                      )
                    }
                  >
                    <Play />
                    {t('workflows.runNow')}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
