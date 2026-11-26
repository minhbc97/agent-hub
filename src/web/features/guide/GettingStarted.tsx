import { Circle, CircleCheck, X } from 'lucide-react';
import { PAGE, useHashRoute, useHub } from '@/lib/hub';
import { TASK_STATUS, USER_ID } from '@/lib/api';
import { markSeen, useSeen } from '@/lib/coachmarks';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const SEEN_ID = 'gettingStarted';

/**
 * First steps of a workspace, ticked off from its own data so nothing extra is stored.
 * Goes away once every step is done, or when the user closes it.
 */
export function GettingStarted() {
  const h = useHub();
  const [, navigate] = useHashRoute();
  const isClosed = useSeen()(SEEN_ID);
  const steps = [
    { id: 'addAgent', isDone: h.agents.some((a) => !a.isOrchestrator), to: `${PAGE.agents}/new` },
    { id: 'sendMessage', isDone: h.messages.some((m) => m.fromId === USER_ID), to: PAGE.home },
    { id: 'createTask', isDone: h.tasks.length > 0, to: PAGE.tasks },
    { id: 'reviewTask', isDone: h.tasks.some((task) => task.status === TASK_STATUS.done), to: PAGE.tasks },
    { id: 'createWorkflow', isDone: h.workflows.length > 0, to: PAGE.workflows },
  ];
  const doneCount = steps.filter((step) => step.isDone).length;
  if (isClosed || !h.ready || !h.ws || doneCount === steps.length) return null;
  return (
    <section aria-labelledby="getting-started" className="mt-7 rounded-lg border bg-card p-3">
      <header className="mb-2 flex items-center gap-2">
        <h2 id="getting-started" className="text-sm font-semibold">
          {t('guide.gettingStarted')}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {doneCount}/{steps.length}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label={t('guide.hideGettingStarted')}
          onClick={() => markSeen(SEEN_ID)}
        >
          <X />
        </Button>
      </header>
      <ul className="grid gap-0.5">
        {steps.map((step) => (
          <li key={step.id}>
            <Button
              variant="ghost"
              size="sm"
              disabled={step.isDone}
              onClick={() => navigate(step.to)}
              className="h-auto w-full justify-start gap-2 px-1.5 py-1 text-left font-normal whitespace-normal disabled:opacity-100"
            >
              {step.isDone ? <CircleCheck className="text-success" /> : <Circle className="text-muted-foreground" />}
              <span className={cn(step.isDone && 'text-muted-foreground line-through')}>
                {t(`guide.steps.${step.id}`)}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
