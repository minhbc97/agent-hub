import { useState } from 'react';
import { ArrowRight, ChevronsUpDown, FolderKanban, Plus } from 'lucide-react';
import { api, type Workspace } from '@/lib/api';
import { PAGE, useHub } from '@/lib/hub';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Field, FolderField } from '@/components/shared';

/** The current workspace; opens a menu to switch to another one or create one. */
export function WorkspaceMenu() {
  const h = useHub();
  const [isCreating, setCreating] = useState(false);
  const workspace = h.ws;
  if (!workspace) return null;
  const open = (id: string) => {
    if (id === workspace.id) return;
    // A page below the top level (e.g. an agent's) belongs to the workspace being left.
    location.hash = `/${PAGE.home}`;
    h.selectWorkspace(id);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="-ml-2 h-auto max-w-full min-w-0 justify-start gap-3 px-2 py-1.5 text-left hover:bg-sidebar-accent"
            aria-label={t('workspace.switchFrom', { name: workspace.name })}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <FolderKanban className="size-5" />
            </span>
            <span className="max-w-96 min-w-0">
              <span className="block truncate text-lg font-semibold tracking-tight">{workspace.name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground" title={workspace.repoPath}>
                {workspace.repoPath}
              </span>
            </span>
            <ChevronsUpDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>{t('workspace.workspaces')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={workspace.id} onValueChange={open}>
            {h.workspaces.map((w) => (
              <DropdownMenuRadioItem key={w.id} value={w.id}>
                <span className="min-w-0">
                  <span className="block truncate">{w.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{w.repoPath}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            {t('workspace.newWorkspace')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={isCreating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('workspace.createWorkspace')}</DialogTitle>
            <DialogDescription>{t('workspace.createDescription')}</DialogDescription>
          </DialogHeader>
          <WorkspaceForm
            onCreated={(created) => {
              setCreating(false);
              open(created.id);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorkspaceForm({ onCreated }: { onCreated: (workspace: Workspace) => void }) {
  const h = useHub();
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [worktreesDir, setWorktreesDir] = useState('');
  return (
    <form
      className="grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const created = await h.attempt(
          () => api.createWorkspace({ name, repoPath, worktreesDir }),
          t('workspace.created'),
        );
        if (created) onCreated(created);
      }}
    >
      <Field label={t('workspace.name')} isRequired>
        <Input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('workspace.exampleTeam')}
        />
      </Field>
      <FolderField label={t('workspace.repositoryPath')} value={repoPath} onChange={setRepoPath} />
      <FolderField
        label={t('workspace.worktreeDirectory')}
        value={worktreesDir}
        onChange={setWorktreesDir}
        placeholder={t('workspace.worktreePlaceholder')}
      />
      <Button type="submit" size="lg" className="mt-2 w-full justify-between" disabled={!name.trim()}>
        {t('workspace.createWorkspace')}
        <ArrowRight />
      </Button>
    </form>
  );
}
