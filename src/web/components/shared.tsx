import { useId, useState } from 'react';
import { ArrowLeft, FolderOpen, Sparkles, UserRound } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
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

export type Tone = { dot: string };

/** Each status keeps one color across the board, the list and the task sheet. */
export const TASK_TONE: Record<TaskStatus, Tone> = {
  todo: { dot: 'bg-muted-foreground' },
  doing: { dot: 'bg-info' },
  review: { dot: 'bg-warning' },
  blocked: { dot: 'bg-destructive' },
  done: { dot: 'bg-success' },
  archived: { dot: 'bg-muted-foreground' },
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
        className="flex items-center justify-center rounded-full bg-primary/15 text-primary-ink"
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

/** The human's avatar: a plain person glyph, so it never reads as one of the generated agents. */
export function UserAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground ring-1 ring-border"
    >
      <UserRound size={size * 0.55} />
    </div>
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

/** The header of every page: back, picture, title and actions share one row. `bar` is for panes that scroll under it. */
export function PageHeading({
  title,
  subtitle,
  back,
  media,
  badges,
  action,
  variant = 'page',
}: {
  title: string;
  subtitle?: string;
  back?: { label: string; onClick: () => void };
  media?: React.ReactNode;
  badges?: React.ReactNode;
  action?: React.ReactNode;
  variant?: 'page' | 'bar';
}) {
  const isBar = variant === 'bar';
  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-3',
        isBar ? 'sticky top-0 z-20 h-16 border-b bg-background px-7' : 'mb-6 min-h-12',
      )}
    >
      {back && (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 shrink-0"
          aria-label={back.label}
          title={back.label}
          onClick={back.onClick}
        >
          <ArrowLeft />
        </Button>
      )}
      {media}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className={cn('truncate font-semibold tracking-tight', isBar ? 'text-lg' : 'text-2xl')}>{title}</h1>
          {badges}
        </div>
        {subtitle && <p className={cn('truncate text-muted-foreground', isBar ? 'text-xs' : 'mt-0.5')}>{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}

/** Title of a block inside a page. */
export function SectionTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('text-base font-semibold', className)}>{children}</h2>;
}

/** Small caption over a value or text block. */
export function Caption({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn('text-xs font-medium text-muted-foreground', className)}>{children}</h3>;
}

/** A switch with its text; the whole row toggles it. */
export function SwitchField({
  label,
  checked,
  onChange,
  size,
  className,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'default';
  className?: string;
}) {
  return (
    <Label className={cn('font-normal', className)}>
      <Switch size={size} checked={checked} onCheckedChange={onChange} />
      {label}
    </Label>
  );
}

/** `isRequired` only marks the label; also set `required` on the control so assistive tech announces it. */
export function Field({
  label: name,
  isRequired = false,
  children,
}: {
  label: string;
  isRequired?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">
        {name}
        {isRequired && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

export function FolderField({
  label,
  value,
  onChange,
  placeholder,
  isRequired = false,
}: {
  label: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  isRequired?: boolean;
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
        {isRequired && (
          <span aria-hidden className="-ml-1.5 text-destructive">
            *
          </span>
        )}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          required={isRequired}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
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
