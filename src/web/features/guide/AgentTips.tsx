import { X } from 'lucide-react';
import { ENGINE, FALLBACK_ENGINES, type Agent } from '@/lib/api';
import { markSeen, useSeen } from '@/lib/coachmarks';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { GuideMascot } from '@/components/Coachmark';

/** Tips that apply to this agent's own setup, so the user only sees ones they can act on. */
function tipsFor(agent: Agent): string[] {
  const isClaude = agent.engine === ENGINE.claude;
  return [
    isClaude && !agent.isLean && 'leanMode',
    FALLBACK_ENGINES.includes(agent.engine) && !agent.fallbackEngine && 'fallbackEngine',
    isClaude && agent.allowedCommands.length === 0 && 'allowedCommands',
  ].filter((tip): tip is string => !!tip);
}

export function AgentTips({ agent, onConfigure }: { agent: Agent; onConfigure: () => void }) {
  const isSeen = useSeen();
  const tips = tipsFor(agent)
    .map((tip) => ({ tip, id: `tip.${tip}.${agent.id}` }))
    .filter(({ id }) => !isSeen(id));
  if (!tips.length) return null;
  return (
    <section className="mb-6 flex items-end gap-3">
      <GuideMascot size={48} />
      <div className="relative min-w-0 flex-1 rounded-xl border-2 border-foreground bg-card px-4 py-3 comic-shadow">
        <span
          aria-hidden
          className="absolute bottom-4 -left-2 size-3.5 rotate-45 border-b-2 border-l-2 border-foreground bg-card"
        />
        <h2 className="text-xs font-black tracking-wider text-primary-ink uppercase">{t('guide.tipsTitle')}</h2>
        <ul className="mt-1 grid gap-1">
          {tips.map(({ tip, id }) => (
            <li key={tip} className="flex items-start gap-2 text-sm/6">
              <span className="min-w-0 flex-1 text-muted-foreground">{t(`guide.tips.${tip}`)}</span>
              <Button variant="link" size="sm" className="h-6 px-1" onClick={onConfigure}>
                {t('common.configure')}
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={t('guide.hideTip')} onClick={() => markSeen(id)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
