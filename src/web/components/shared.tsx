import { useId, useState } from 'react';
import { FolderOpen, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { createAvatar } from '@dicebear/core';
import { micah } from '@dicebear/collection';
import { api, type Agent, type TaskStatus } from '@/lib/api';
import { agentState, useHub, type AgentState } from '@/lib/hub';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

export type Tone = { column: string; dot: string };

/** Each status keeps one color across the board, the list and the task sheet. */
export const TASK_TONE: Record<TaskStatus, Tone> = {
  todo: { column: 'border-muted-foreground/50 bg-muted/40', dot: 'bg-muted-foreground' },
  doing: { column: 'border-info bg-info/5', dot: 'bg-info' },
  review: { column: 'border-warning bg-warning/5', dot: 'bg-warning' },
  blocked: { column: 'border-destructive bg-destructive/5', dot: 'bg-destructive' },
  done: { column: 'border-success bg-success/5', dot: 'bg-success' },
  archived: { column: 'border-muted-foreground/30 bg-muted/20', dot: 'bg-muted-foreground/50' },
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

/** Takes an unsaved agent too, so the agent form can preview avatar choices. */
export function Avatar({ agent, size = 32 }: { agent?: Pick<Agent, 'name' | 'avatarSeed' | 'tint'>; size?: number }) {
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

/** Avatar with the agent's live state as a dot; `ringClassName` matches the surface it sits on. */
export function AgentAvatar({
  agent,
  size,
  ringClassName = 'ring-background',
}: {
  agent: Agent;
  size: number;
  ringClassName?: string;
}) {
  const h = useHub();
  return (
    <span className="relative shrink-0">
      <Avatar agent={agent} size={size} />
      <span
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2',
          ringClassName,
          statusDot[agentState(agent, h.messages)],
        )}
      />
    </span>
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

export function FolderField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [isPicking, setPicking] = useState(false);
  const pick = async () => {
    setPicking(true);
    try {
      const result = await api.pickFolder();
      if (result.path) onChange(result.path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('errors.folderPickerFailed'));
    } finally {
      setPicking(false);
    }
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="font-normal text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <Button type="button" variant="outline" disabled={isPicking} onClick={pick}>
          <FolderOpen />
          {t('common.chooseFolder')}
        </Button>
      </div>
    </div>
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
