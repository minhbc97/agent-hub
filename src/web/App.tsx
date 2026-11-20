import { useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bot,
  House,
  Inbox,
  Moon,
  Plus,
  Settings,
  Sun,
  Workflow as WorkflowIcon,
  Columns3,
  ArrowRight,
  FolderKanban,
} from 'lucide-react';
import { PAGE, useHub, useHashRoute, waitingOnUser } from '@/lib/hub';
import { AGENT_STATUS, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { AGENT_THREAD, INBOX_CHANNEL, InboxPage } from '@/features/inbox/InboxPage';
import { HomePage } from '@/features/home/HomePage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { WorkflowsPage } from '@/features/workflows/WorkflowsPage';
import { AgentsPage, AgentDetail, LeadAgentDialog } from '@/features/agents/AgentsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AgentAvatar, Field, FolderField } from '@/components/shared';

const THEME = { dark: 'dark', light: 'light' } as const;

const iconMap: Record<(typeof PAGE)[keyof typeof PAGE], typeof Inbox> = {
  home: House,
  inbox: Inbox,
  tasks: Columns3,
  workflows: WorkflowIcon,
  agents: Bot,
  settings: Settings,
} as const;

export function App() {
  const h = useHub();
  const [parts, navigate] = useHashRoute();
  const page = parts[0] || PAGE.home;
  const [filter, setFilter] = useState<string>(INBOX_CHANNEL.team);
  const needs = waitingOnUser(h.tasks, h.messages);
  const createAgent = page === PAGE.agents && parts[1] === 'new';
  const agentPage = page === PAGE.agents && parts[1] && !createAgent ? parts[1] : null;
  const isInbox = page === PAGE.inbox;
  const openInbox = (channel: string) => {
    navigate(PAGE.inbox);
    setFilter(channel);
  };
  if (!h.ws) return <Welcome isReady={h.ready} />;
  return (
    <div className="flex h-full min-h-0 min-w-(--app-min-width) flex-col bg-background">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col overflow-y-auto bg-sidebar px-3 py-5">
          <nav className="grid gap-1">
            {Object.values(PAGE).map((p) => {
              const Icon = iconMap[p];
              return (
                <SidebarItem
                  key={p}
                  isActive={page === p && !agentPage}
                  // With something waiting on the user, the inbox opens straight on it.
                  onClick={() =>
                    p === PAGE.inbox
                      ? openInbox(needs.count > 0 ? INBOX_CHANNEL.needs : INBOX_CHANNEL.team)
                      : navigate(p)
                  }
                >
                  <Icon />
                  {t(`nav.${p}`)}
                  {p === PAGE.inbox && needs.count > 0 && <Badge className="ml-auto">{needs.count}</Badge>}
                </SidebarItem>
              );
            })}
          </nav>
          {h.agents.length > 0 && (
            <>
              <div className="mt-7 mb-2 flex items-center justify-between px-2 text-xs tracking-wider text-muted-foreground uppercase">
                <span>{t('agents.title')}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('agents.addAgent')}
                  onClick={() => navigate(`${PAGE.agents}/new`)}
                >
                  <Plus />
                </Button>
              </div>
              <div className="grid gap-1">
                {h.agents.map((a) => (
                  <SidebarItem
                    key={a.id}
                    isActive={(isInbox && filter === AGENT_THREAD + a.id) || agentPage === a.id}
                    onClick={() => openInbox(AGENT_THREAD + a.id)}
                  >
                    <AgentAvatar agent={a} size={22} ringClassName="ring-sidebar" />
                    <span className="truncate">{a.name}</span>
                    {a.status === AGENT_STATUS.working && (
                      <span className="ml-auto text-xs font-normal text-muted-foreground">{t('agents.working')}</span>
                    )}
                  </SidebarItem>
                ))}
              </div>
            </>
          )}
          <p className="mt-auto px-2 text-xs text-muted-foreground">{t('app.avatarLicense')}</p>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {page === PAGE.inbox ? (
            <InboxPage filter={filter} setFilter={setFilter} />
          ) : (
            <div className="flex min-h-full flex-col p-7">
              {page === PAGE.home ? (
                <HomePage
                  openAgent={(id) => openInbox(AGENT_THREAD + id)}
                  openNeeds={() => openInbox(INBOX_CHANNEL.needs)}
                />
              ) : page === PAGE.tasks ? (
                <TasksPage />
              ) : page === PAGE.workflows ? (
                <WorkflowsPage />
              ) : page === PAGE.agents ? (
                agentPage ? (
                  <AgentDetail id={agentPage} />
                ) : (
                  <AgentsPage openCreate={createAgent} />
                )
              ) : (
                <SettingsPage />
              )}
            </div>
          )}
        </main>
      </div>
      {h.ready && !h.agents.some((agent) => agent.isOrchestrator) && <LeadAgentDialog />}
    </div>
  );
}

function SidebarItem({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'h-9 w-full justify-start gap-2.5 px-2.5 font-normal hover:bg-sidebar-accent',
        isActive ? 'bg-sidebar-accent font-medium' : 'text-muted-foreground',
      )}
    >
      {children}
    </Button>
  );
}

function WorkspaceMenu() {
  const h = useHub();
  const workspace = h.ws;
  if (!workspace) return null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <FolderKanban size={20} />
      </div>
      <div className="min-w-0">
        {h.workspaces.length === 1 ? (
          <div className="max-w-96 truncate text-lg font-semibold tracking-tight" title={workspace.name}>
            {workspace.name}
          </div>
        ) : (
          <Select value={workspace.id} onValueChange={h.selectWorkspace}>
            <SelectTrigger
              className="-ml-2 h-8 max-w-96 border-0 bg-transparent px-2 text-lg font-semibold shadow-none hover:bg-sidebar-accent"
              aria-label={t('workspace.workspace')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {h.workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="max-w-96 truncate text-xs text-muted-foreground" title={workspace.repoPath}>
          {workspace.repoPath}
        </div>
      </div>
    </div>
  );
}

function AppHeader() {
  const h = useHub();
  const { theme, setTheme } = useTheme();
  const { i18n: activeI18n } = useTranslation();
  return (
    <header className="flex h-18 shrink-0 items-center bg-sidebar">
      <div className="flex w-60 shrink-0 items-center gap-2.5 px-6">
        <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Activity size={18} />
        </div>
        <span className="text-sm font-medium tracking-tight">{t('app.brand')}</span>
      </div>
      <div className="min-w-0 flex-1 px-7">{h.ws && <WorkspaceMenu />}</div>
      <div className="flex shrink-0 items-center gap-2 pr-6">
        <Select
          value={activeI18n.resolvedLanguage?.startsWith('en') ? 'en' : 'vi'}
          onValueChange={(language) => void activeI18n.changeLanguage(language)}
        >
          <SelectTrigger size="sm" aria-label={t('common.language')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vi">{t('common.languageVi')}</SelectItem>
            <SelectItem value="en">{t('common.languageEn')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.toggleTheme')}
          onClick={() => setTheme(theme === THEME.dark ? THEME.light : THEME.dark)}
        >
          {theme === THEME.dark ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}

function Welcome({ isReady }: { isReady: boolean }) {
  const h = useHub();
  const [name, setName] = useState(''),
    [repoPath, setRepo] = useState(''),
    [worktreesDir, setTree] = useState('');
  return (
    <div className="flex min-h-full min-w-(--app-min-width) flex-col bg-background">
      <AppHeader />
      <main className="flex flex-1 items-center justify-center px-12 py-16">
        {!isReady ? (
          <p className="text-muted-foreground">{t('common.loading')}</p>
        ) : (
          <div className="grid w-full max-w-6xl grid-cols-2 items-center gap-18">
            <div className="max-w-xl">
              <h1 className="text-5xl font-semibold tracking-tight text-balance">
                {t('workspace.setUpYourWorkspace')}
              </h1>
              <p className="mt-6 max-w-md text-base/7 text-muted-foreground">{t('workspace.welcomeDescription')}</p>
            </div>
            <Card className="gap-0 p-0">
              <div className="border-b px-8 py-6">
                <h2 className="text-lg font-semibold">{t('workspace.createWorkspace')}</h2>
              </div>
              <form
                className="grid gap-5 p-8"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const created = await h.attempt(
                    () => api.createWorkspace({ name, repoPath, worktreesDir }),
                    t('workspace.created'),
                  );
                  if (created) location.hash = `/${PAGE.agents}`;
                }}
              >
                <Field label={t('workspace.name')}>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('workspace.exampleTeam')}
                  />
                </Field>
                <FolderField label={t('workspace.repositoryPath')} value={repoPath} onChange={setRepo} />
                <FolderField
                  label={t('workspace.worktreeDirectory')}
                  value={worktreesDir}
                  onChange={setTree}
                  placeholder={t('workspace.worktreePlaceholder')}
                />
                <Button type="submit" size="lg" className="mt-2 w-full justify-between" disabled={!name.trim()}>
                  {t('workspace.createWorkspace')}
                  <ArrowRight />
                </Button>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
