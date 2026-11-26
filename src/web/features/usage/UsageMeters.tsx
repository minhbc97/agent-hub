import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, RefreshCw } from 'lucide-react';
import { USAGE_STATUS, api, type EngineUsage, type UsageWindow } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ProviderIcon } from '@/components/ProviderIcon';
import { EngineSetup } from '@/components/EngineSetup';
import { useHub } from '@/lib/hub';
import { i18n, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/query';

/** Matches the server cache, so polling never asks the CLIs more than once a minute. */
const POLL_MS = 60_000;
const NEAR_LIMIT_PERCENT = 80;
const FULL_PERCENT = 100;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Plan limits per engine in the header: one compact meter each, details in a popover. */
export function UsageMeters() {
  const queryClient = useQueryClient();
  const usageQuery = useQuery({
    queryKey: qk.usage,
    queryFn: () => api.usage(),
    refetchInterval: POLL_MS,
  });
  const refreshMutation = useMutation({
    mutationFn: () => api.usage(true),
    onSuccess: (report) => queryClient.setQueryData(qk.usage, report),
  });
  const lastPollSuccess = useRef(usageQuery.dataUpdatedAt);
  useEffect(() => {
    if (usageQuery.dataUpdatedAt === lastPollSuccess.current) return;
    lastPollSuccess.current = usageQuery.dataUpdatedAt;
    refreshMutation.reset();
  }, [usageQuery.dataUpdatedAt, refreshMutation.reset]);
  const report = usageQuery.data ?? null;
  const error = refreshMutation.error ?? usageQuery.error;
  const isLoading = usageQuery.isFetching || refreshMutation.isPending;
  const readable = report?.engines.filter((e) => e.status === USAGE_STATUS.ok) ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-auto gap-3 py-1" aria-label={t('usage.title')}>
          {readable.length ? (
            readable.map((engine) => {
              const percent = headlinePercent(engine);
              return (
                <span key={engine.engine} className="grid w-16 gap-1" title={engine.label}>
                  <span className="flex items-center justify-between gap-1 text-xs">
                    <ProviderIcon engine={engine.engine} className="size-3.5" />
                    <span className="font-semibold tabular-nums">{percent}%</span>
                  </span>
                  <Meter percent={percent} isSlim />
                </span>
              );
            })
          ) : (
            <>
              <Gauge />
              {t('usage.title')}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <span className="font-semibold">{t('usage.title')}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {t('usage.freshness')}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('usage.refresh')}
              disabled={isLoading}
              onClick={() => refreshMutation.mutate()}
            >
              <RefreshCw className={cn(isLoading && 'animate-spin')} />
            </Button>
          </span>
        </div>
        {error && (
          <p className="border-b px-4 py-3 text-xs text-destructive">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {!report && !error && <p className="px-4 py-3 text-xs text-muted-foreground">{t('usage.loading')}</p>}
        {report?.engines.map((engine) => (
          <EngineSection key={engine.engine} engine={engine} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function EngineSection({ engine }: { engine: EngineUsage }) {
  const percent = headlinePercent(engine);
  const info = useHub().meta?.engines.find((e) => e.id === engine.engine);
  return (
    <section className="grid gap-3 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <ProviderIcon engine={engine.engine} />
        <span className="font-semibold">{engine.label}</span>
        {engine.plan && <span className="text-xs text-muted-foreground capitalize">{engine.plan}</span>}
        {engine.status === USAGE_STATUS.ok && percent >= FULL_PERCENT && (
          <Badge variant="destructive" className="ml-auto">
            {t('usage.limitReached')}
          </Badge>
        )}
        {engine.status === USAGE_STATUS.ok && percent >= NEAR_LIMIT_PERCENT && percent < FULL_PERCENT && (
          <Badge variant="warning" className="ml-auto">
            {t('usage.nearLimit')}
          </Badge>
        )}
        {engine.status !== USAGE_STATUS.ok && (
          <Badge variant="secondary" className="ml-auto">
            {t(`usage.status.${engine.status}`)}
          </Badge>
        )}
      </div>
      {engine.status === USAGE_STATUS.ok ? (
        engine.windows.map((window) => <WindowRow key={window.window} window={window} />)
      ) : (
        <p className="text-xs text-muted-foreground">{t(`usage.hint.${engine.status}`, { name: engine.label })}</p>
      )}
      {info && (engine.status === USAGE_STATUS.notInstalled || engine.status === USAGE_STATUS.notSignedIn) && (
        <EngineSetup engine={info} />
      )}
    </section>
  );
}

function WindowRow({ window }: { window: UsageWindow }) {
  const used = Math.round(window.usedPercent);
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between text-sm">
        <span>{t(`usage.window.${window.window}`)}</span>
        <span className={cn('font-semibold tabular-nums', toneText(used))}>{t('usage.used', { percent: used })}</span>
      </div>
      <Meter percent={used} />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{window.resetsAt ? formatReset(window.resetsAt) : t('usage.noReset')}</span>
        <span className="tabular-nums">{t('usage.left', { percent: Math.max(0, FULL_PERCENT - used) })}</span>
      </div>
    </div>
  );
}

function Meter({ percent, isSlim = false }: { percent: number; isSlim?: boolean }) {
  return (
    <span className={cn('block overflow-hidden rounded-full bg-muted', isSlim ? 'h-1' : 'h-2')}>
      <span
        className={cn('block h-full rounded-full', toneBar(percent))}
        style={{ width: `${Math.min(FULL_PERCENT, Math.max(0, percent))}%` }}
      />
    </span>
  );
}

/** The window closest to its cap is the one that will stop the agents first. */
function headlinePercent(engine: EngineUsage): number {
  return Math.round(Math.max(0, ...engine.windows.map((w) => w.usedPercent)));
}

const toneBar = (percent: number) =>
  percent >= FULL_PERCENT ? 'bg-destructive' : percent >= NEAR_LIMIT_PERCENT ? 'bg-warning' : 'bg-primary';

const toneText = (percent: number) =>
  percent >= FULL_PERCENT ? 'text-destructive' : percent >= NEAR_LIMIT_PERCENT ? 'text-warning' : '';

/** Within a day: "resets in 4 h 08 min"; later: "resets Mon 10:42 PM" in the UI language. */
function formatReset(iso: string): string {
  const at = new Date(iso);
  const left = at.getTime() - Date.now();
  if (left <= 0) return t('usage.resetSoon');
  if (left < DAY_MS) {
    const hours = Math.floor(left / HOUR_MS);
    const minutes = String(Math.floor((left % HOUR_MS) / MINUTE_MS)).padStart(2, '0');
    return t('usage.resetsIn', { hours, minutes });
  }
  const time = at.toLocaleString(i18n.resolvedLanguage || 'en', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return t('usage.resetsAt', { time });
}
