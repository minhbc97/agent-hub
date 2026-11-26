import { useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  House,
  Inbox,
  Moon,
  Plus,
  Settings,
  Sun,
  Workflow as WorkflowIcon,
  Columns3,
  Copy,
  X,
} from 'lucide-react';
import { PAGE, useHub, useHashRoute, waitingOnUser } from '@/lib/hub';
import { AGENT_STATUS } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { AGENT_THREAD, INBOX_CHANNEL, InboxPage } from '@/features/inbox/InboxPage';
import { HomePage } from '@/features/home/HomePage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { WorkflowsPage } from '@/features/workflows/WorkflowsPage';
import { AgentsPage, AgentDetail, LeadAgentDialog } from '@/features/agents/AgentsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { UsageMeters } from '@/features/usage/UsageMeters';
import { GettingStarted } from '@/features/guide/GettingStarted';
import { AgentAvatar } from '@/components/shared';
import { WorkspaceForm, WorkspaceMenu } from '@/components/WorkspaceMenu';
import { MOTION } from '@/lib/motion';
import { markSeen, useSeen } from '@/lib/coachmarks';
import { toast } from 'sonner';

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
  // Pages translate with the plain `t()`, so the root subscribes to language changes and re-renders the tree.
  useTranslation();
  const h = useHub();
  if (!h.ws)
    return (
      <MotionConfig reducedMotion="user">
        <Welcome isReady={h.ready} />
      </MotionConfig>
    );
  // Remounted per workspace, so filters, drafts and open panels of one never show in another.
  return (
    <MotionConfig reducedMotion="user">
      <WorkspaceShell key={h.ws.id} />
    </MotionConfig>
  );
}

function WorkspaceShell() {
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
          <GettingStarted />
          <p className="mt-auto px-2 text-xs text-muted-foreground">{t('app.avatarLicense')}</p>
        </aside>
        {/* relative: absolutely positioned descendants (e.g. Radix hidden inputs) must scroll inside main, not stretch the page. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={page}
            initial={{ opacity: 0, y: MOTION.page.offsetY }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -MOTION.page.offsetY }}
            transition={MOTION.page}
            className={cn(
              'relative min-h-0 min-w-0 flex-1',
              page === PAGE.home
                ? 'overflow-hidden max-lg:overflow-auto [@media(max-height:760px)]:overflow-auto'
                : 'overflow-auto',
            )}
          >
            {page === PAGE.inbox ? (
              <InboxPage filter={filter} setFilter={setFilter} />
            ) : (
              <div
                className={cn(
                  'flex flex-col p-7',
                  page === PAGE.home || page === PAGE.tasks ? 'h-full min-h-0' : 'min-h-full',
                )}
              >
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
          </motion.main>
        </AnimatePresence>
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

function AppHeader() {
  const h = useHub();
  const { theme, setTheme } = useTheme();
  const { i18n: activeI18n } = useTranslation();
  const hasSeen = useSeen();
  const latestVersion = h.meta?.latestVersion;
  const updateId = latestVersion ? `update.${latestVersion}` : null;
  const shouldShowUpdate = !!updateId && !hasSeen(updateId);
  const updateCommand = 'npx @minhbc/agent-hub@latest';
  const copyUpdateCommand = () =>
    navigator.clipboard.writeText(updateCommand).then(
      () => toast.success(t('tasks.copied')),
      (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
    );
  return (
    <>
      <header className="flex h-18 shrink-0 items-center bg-sidebar">
        <div className="flex w-60 shrink-0 items-center gap-2.5 px-6">
          <div className="grid size-8 place-items-center rounded-lg bg-primary">
            <img src="/agent-hub-mark.svg" alt="" aria-hidden="true" className="size-6" />
          </div>
          <span className="text-sm font-semibold tracking-tight">{t('app.brand')}</span>
        </div>
        <div className="min-w-0 flex-1 px-7">{h.ws && <WorkspaceMenu />}</div>
        <div className="flex shrink-0 items-center gap-2 pr-6">
          <UsageMeters />
          <Select
            value={activeI18n.resolvedLanguage?.startsWith('vi') ? 'vi' : 'en'}
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
      {shouldShowUpdate && latestVersion && updateId && (
        <section className="mx-6 my-3 flex items-center gap-3 border-2 border-foreground bg-card p-3 comic-shadow-sm">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {t('app.updateAvailable', { latest: latestVersion, current: h.meta?.version })}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <code className="truncate font-mono">{updateCommand}</code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('app.copyUpdateCommand')}
                onClick={copyUpdateCommand}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t('app.updateRestart')}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t('app.dismissUpdate')} onClick={() => markSeen(updateId)}>
            <X />
          </Button>
        </section>
      )}
    </>
  );
}

function Welcome({ isReady }: { isReady: boolean }) {
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
              <div className="p-8">
                <WorkspaceForm onCreated={() => (location.hash = `/${PAGE.agents}`)} />
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
