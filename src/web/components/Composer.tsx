import { useState, type FormEvent } from 'react';
import { Send, Zap } from 'lucide-react';
import { useHub } from '@/lib/hub';
import type { Agent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/shared';

/** In an agent's channel the recipient is that agent; in a task thread it starts at the task's assignee. */
export function Composer({
  fixedRecipient,
  taskRecipient,
  taskId,
  className,
  placeholder: customPlaceholder,
}: {
  fixedRecipient?: Agent;
  taskRecipient?: Agent;
  taskId?: string;
  className?: string;
  placeholder?: string;
}) {
  const h = useHub();
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [recipient, setRecipient] = useState(
    () =>
      fixedRecipient?.id ?? taskRecipient?.id ?? h.agents.find((a) => a.isOrchestrator)?.id ?? h.agents[0]?.id ?? '',
  );
  const to = fixedRecipient?.id ?? recipient;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !h.ws || !to) return;
    // Clear at once: the message shows in the thread as "sending" while the request runs.
    setBody('');
    setUrgent(false);
    const sent = await h.sendMessage({ to, body, urgent, taskId });
    // Restore a failed draft so nothing typed is lost, unless something new was typed meanwhile.
    if (!sent) setBody((current) => current || body);
  };
  const placeholder =
    customPlaceholder ??
    (fixedRecipient ? t('inbox.composerTo', { name: fixedRecipient.name }) : t('inbox.composerPlaceholder'));
  return (
    <form onSubmit={send} className={cn('shrink-0 px-6 pb-5', className)}>
      <div className="w-full rounded-xl bg-card ring-1 ring-border focus-within:ring-2 focus-within:ring-ring/40">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          aria-label={placeholder}
          placeholder={placeholder}
          className="max-h-60 min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-3 px-2 pb-2">
          {!fixedRecipient && (
            <Select value={to} onValueChange={setRecipient}>
              <SelectTrigger size="sm" className="text-xs" aria-label={t('inbox.recipient')}>
                <span className="text-muted-foreground">{t('inbox.to')}</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {h.agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <Avatar agent={a} size={18} />
                    {a.name}
                    {a.isOrchestrator && <span className="text-muted-foreground">{t('agents.orchestrator')}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch size="sm" checked={urgent} onCheckedChange={setUrgent} />
            <Zap size={13} />
            {t('inbox.urgent')}
          </label>
          <span className="ml-auto text-xs text-muted-foreground">{t('inbox.sendHint')}</span>
          <Button size="sm" disabled={!body.trim() || !to}>
            <Send />
            {t('common.send')}
          </Button>
        </div>
      </div>
    </form>
  );
}
