import { Sparkles } from 'lucide-react';
import { createAvatar } from '@dicebear/core';
import { micah } from '@dicebear/collection';
import { type Agent, type TaskStatus } from '@/lib/api';
import { type AgentState } from '@/lib/hub';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export const label: Record<TaskStatus, string> = {
  todo: 'tasks.todo',
  doing: 'tasks.inProgress',
  review: 'tasks.review',
  blocked: 'tasks.blocked',
  done: 'tasks.done',
  archived: 'tasks.archived',
};

export const statusDot: Record<AgentState, string> = {
  idle: 'bg-muted-foreground',
  working: 'bg-success',
  held: 'bg-warning',
  paused: 'bg-muted-foreground',
};

export const uid = () => crypto.randomUUID();

// Building the SVG is costly and the inbox re-renders on every hub event, so reuse it per seed + tint.
const avatarCache = new Map<string, string>();

function avatarUri(seed: string, tint: string): string {
  const key = `${seed}|${tint}`;
  let uri = avatarCache.get(key);
  if (!uri) {
    uri = createAvatar(micah, { seed, backgroundColor: [tint.replace('#', '')], radius: 50 }).toDataUri();
    avatarCache.set(key, uri);
  }
  return uri;
}

export function Avatar({ agent, size = 32 }: { agent?: Agent; size?: number }) {
  if (!agent)
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-full bg-primary/15 text-primary"
      >
        <Sparkles size={size * 0.5} />
      </div>
    );
  const src = avatarUri(agent.avatarSeed || agent.name, agent.tint);
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, borderColor: agent.tint }}
      className="shrink-0 rounded-full border-2 object-cover"
    />
  );
}

export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label: name, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{name}</span>
      {children}
    </label>
  );
}

export function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <div className="mx-auto grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">{icon}</div>
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/** A destructive button that asks first. */
export function ConfirmButton({
  title,
  description,
  onConfirm,
  className,
  children,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive" className={className}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
