import { ExternalLink } from 'lucide-react';
import type { EngineInfo } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * What the user does once so the hub can run this CLI: install it if missing, otherwise sign it in from a terminal.
 * The hub never signs in itself; every agent reuses the CLI's own login.
 */
export function EngineSetup({ engine, className }: { engine: EngineInfo; className?: string }) {
  if (engine.installed === false)
    return (
      <p className={cn('text-xs/5 text-warning', className)}>
        {t('engines.notInstalled', { name: engine.label, command: engine.defaultCommand })}{' '}
        {engine.installUrl && (
          <Button variant="link" size="xs" className="h-auto p-0" asChild>
            <a href={engine.installUrl} target="_blank" rel="noreferrer">
              {t('engines.installGuide')}
              <ExternalLink />
            </a>
          </Button>
        )}
      </p>
    );
  if (!engine.loginCommand) return null;
  return (
    <p className={cn('text-xs/5 text-muted-foreground', className)}>
      {t('engines.loginHint', { name: engine.label, command: engine.loginCommand })}
    </p>
  );
}
