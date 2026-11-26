import { useQuery } from '@tanstack/react-query';
import { COACHMARK, Coachmark } from './Coachmark';
import { ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { api, type FileChange, type Task } from '@/lib/api';
import { Caption } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useHub } from '@/lib/hub';
import { qk } from '@/lib/query';

/** The code a task changed and how to merge it; renders nothing for a task without code of its own. */
export function TaskChanges({ task, className }: { task: Task; className?: string }) {
  const { ws } = useHub();
  const changesQuery = useQuery({
    queryKey: qk.taskChanges(task.id, task.updatedAt),
    queryFn: () => api.taskChanges(task.id),
    enabled: !!ws,
    staleTime: Infinity,
  });
  const changes = changesQuery.data;
  if (changesQuery.error)
    return (
      <p className={cn('text-sm text-destructive', className)}>
        {changesQuery.error instanceof Error ? changesQuery.error.message : String(changesQuery.error)}
      </p>
    );
  if (!changes) return null;
  const mergeCommand = `git merge ${changes.branch}`;
  const copy = () =>
    navigator.clipboard.writeText(mergeCommand).then(
      () => toast.success(t('tasks.copied')),
      (e: Error) => toast.error(e.message),
    );
  return (
    <section className={className}>
      <Caption className="mb-2">{t('tasks.codeChanges', { count: changes.files.length })}</Caption>
      {changes.files.length > 0 && (
        <>
          <div className="divide-y overflow-hidden rounded-lg border">
            {changes.files.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </div>
          <Coachmark id={COACHMARK.taskChanges}>
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <span className="shrink-0">{t('tasks.mergeYourself')}</span>
              <code className="min-w-0 truncate font-mono">{mergeCommand}</code>
              <Button variant="ghost" size="icon-sm" aria-label={t('tasks.copyMergeCommand')} onClick={copy}>
                <Copy />
              </Button>
            </div>
          </Coachmark>
        </>
      )}
    </section>
  );
}

function FileRow({ file }: { file: FileChange }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group w-full justify-start rounded-none font-normal">
          <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0 truncate font-mono">{file.path}</span>
          <span className="ml-auto text-success">+{file.added}</span>
          <span className="text-destructive">-{file.deleted}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {file.patch === null ? (
          <p className="p-3 text-xs text-muted-foreground">{t('tasks.patchTooLarge')}</p>
        ) : (
          <pre className="max-h-96 overflow-auto bg-muted/60 p-3 font-mono text-xs/5">
            {file.patch.split('\n').map((line, i) => (
              <span key={i} className={cn('block', lineTone(line))}>
                {line || ' '}
              </span>
            ))}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function lineTone(line: string): string {
  if (line.startsWith('+')) return 'text-success';
  if (line.startsWith('-')) return 'text-destructive';
  if (line.startsWith('@@') || line.startsWith('diff --git')) return 'text-muted-foreground';
  return '';
}
