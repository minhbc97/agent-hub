import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ChevronRight, CircleX, MessageSquareText, SquareTerminal } from 'lucide-react';
import {
  api,
  RUN_STATUS,
  TERMINAL_KIND,
  TERMINAL_MAX_ENTRIES,
  type Agent,
  type TerminalEntry,
  type TerminalKind,
  type TerminalOutput,
} from '@/lib/api';
import { useHub } from '@/lib/hub';
import { qk } from '@/lib/query';
import { i18n, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/shared';

const STICK_TO_BOTTOM_PX = 40;

const KIND_CLASS: Record<TerminalKind, string> = {
  start: 'text-muted-foreground',
  input: 'text-foreground',
  text: 'text-foreground',
  thinking: 'text-muted-foreground italic',
  shell: 'text-foreground font-medium',
  tool: 'text-info',
  output: 'text-muted-foreground',
  // Long failing output would be a wall of red; the red marker alone says it failed.
  error: 'text-foreground',
};

const STATUS_DOT = {
  [RUN_STATUS.running]: 'bg-success',
  [RUN_STATUS.ok]: 'bg-muted-foreground',
  [RUN_STATUS.failed]: 'bg-destructive',
} as const;

/** What an entry line starts with. A shell command has the folder instead, like a command prompt. */
const MARKER: Partial<Record<TerminalKind, typeof ChevronRight>> = {
  input: MessageSquareText,
  tool: ChevronRight,
  error: CircleX,
};

/** Dark in both themes, like a command window. Read-only output of the agent's current turn, or of its last one when it is idle. */
export function AgentTerminal({ agent, leading }: { agent: Agent; leading?: React.ReactNode }) {
  const output = useTerminalOutput(agent);
  const scroller = useRef<HTMLDivElement>(null);
  const [isFollowing, setFollowing] = useState(true);
  const lastSeq = output?.entries.at(-1)?.seq;
  useEffect(() => {
    const el = scroller.current;
    if (el && isFollowing) el.scrollTop = el.scrollHeight;
  }, [output?.runId, lastSeq, isFollowing]);
  if (!output) return <p className="p-5 text-muted-foreground">{t('common.loading')}</p>;
  return (
    <div className="dark flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
        {leading}
        {output.status && (
          <>
            <span className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[output.status])} />
            <span className="font-medium text-foreground">{t(`agents.terminal.status.${output.status}`)}</span>
          </>
        )}
        {output.startedAt && <span>{timeOf(output.startedAt)}</span>}
        <span className="ml-auto">{t('agents.terminal.readOnly')}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          role="log"
          aria-live="off"
          aria-label={t('agents.terminal.title')}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX);
          }}
          className="h-full overflow-auto p-4 font-mono text-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {output.droppedEntries > 0 && (
            <p className="mb-2 text-muted-foreground">
              {t('agents.terminal.dropped', { count: output.droppedEntries })}
            </p>
          )}
          {!output.runId && (
            <Empty icon={<SquareTerminal />} title={t('agents.noRuns')} body={t('agents.terminal.emptyHint')} />
          )}
          {output.runId && output.entries.length === 0 && (
            <p className="text-muted-foreground">{t('agents.terminal.waiting')}</p>
          )}
          {output.entries.map((entry) => (
            <Entry key={entry.seq} entry={entry} cwd={output.cwd} />
          ))}
          {output.status === RUN_STATUS.running ? (
            <span aria-hidden className="inline-block h-4 w-2 bg-foreground motion-safe:animate-pulse" />
          ) : (
            output.startedAt &&
            output.endedAt && (
              <p className={cn('mt-2', output.status === RUN_STATUS.ok ? 'text-success' : 'text-destructive')}>
                {t(`agents.terminal.ended.${output.status}`, {
                  duration: durationOf(output.startedAt, output.endedAt),
                })}
              </p>
            )
          )}
        </div>
        {!isFollowing && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-5 bottom-4 shadow-md"
            onClick={() => setFollowing(true)}
          >
            <ArrowDown />
            {t('agents.terminal.jumpToLatest')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Entry({ entry, cwd }: { entry: TerminalEntry; cwd: string }) {
  const Marker = MARKER[entry.kind];
  const text =
    entry.kind === TERMINAL_KIND.start
      ? t('agents.terminal.started', { model: entry.text || t('common.default') })
      : entry.text;
  return (
    <div className="flex gap-3 py-0.5">
      <span className="shrink-0 text-muted-foreground tabular-nums">{timeOf(entry.at)}</span>
      <span className={cn('min-w-0 flex-1 wrap-break-word whitespace-pre-wrap', KIND_CLASS[entry.kind])}>
        {entry.kind === TERMINAL_KIND.shell && (
          <span className="font-normal text-success select-none" title={cwd}>
            {folderName(cwd)}&gt;{' '}
          </span>
        )}
        {Marker && (
          <Marker
            aria-hidden
            className={cn(
              'mr-1 inline size-3.5',
              entry.kind === TERMINAL_KIND.error
                ? 'text-destructive'
                : entry.kind === TERMINAL_KIND.input && 'text-primary-ink',
            )}
          />
        )}
        {text}
      </span>
    </div>
  );
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.resolvedLanguage || 'en', { hour12: false });
}

/** The last folder is enough to tell worktrees apart; the title has the whole path. */
function folderName(cwd: string): string {
  return cwd.split(/[\\/]/).findLast(Boolean) ?? '';
}

function durationOf(start: string, end: string): string {
  const seconds = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function useTerminalOutput({ id, status }: Agent): TerminalOutput | null {
  const { onTerminalOutput, ws } = useHub();
  const terminalQuery = useQuery({
    queryKey: qk.terminal(ws?.id ?? '', id),
    queryFn: () => api.terminal(id, '', 0),
    enabled: !!ws,
    staleTime: Infinity,
  });
  const [output, setOutput] = useState<TerminalOutput | null>(null);
  const shown = useRef<TerminalOutput | null>(null);
  useEffect(() => {
    if (!terminalQuery.data) return;
    shown.current = terminalQuery.data;
    setOutput(terminalQuery.data);
  }, [terminalQuery.data]);
  useEffect(() => {
    if (!terminalQuery.isSuccess) return;
    let isCurrent = true;
    let isLoading = false;
    let isStale = false;
    const load = async () => {
      // One request at a time, so two answers can never append the same entries.
      if (isLoading) {
        isStale = true;
        return;
      }
      isLoading = true;
      do {
        isStale = false;
        const have = shown.current;
        const next = await api.terminal(id, have?.runId ?? '', have?.entries.at(-1)?.seq ?? 0).catch(() => null);
        if (!isCurrent) return;
        if (!next) continue; // the hub may be restarting; the next event loads again
        const entries = have && have.runId === next.runId ? [...have.entries, ...next.entries] : next.entries;
        shown.current = { ...next, entries: entries.slice(-TERMINAL_MAX_ENTRIES) };
        setOutput(shown.current);
      } while (isStale);
      isLoading = false;
    };
    const stop = onTerminalOutput((agentId) => {
      if (agentId === id) void load();
    });
    return () => {
      isCurrent = false;
      stop();
    };
    // The status too: after a hub restart the turn is over without a last output event.
  }, [id, status, onTerminalOutput, terminalQuery.isSuccess]);
  return output ?? terminalQuery.data ?? null;
}
