import { useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Bot,
  Inbox,
  Moon,
  Plus,
  Settings,
  Sun,
  Workflow as WorkflowIcon,
  Columns3,
  Sparkles,
} from 'lucide-react';
import { PAGE, useHub, useHashRoute, agentState, waitingOnUser } from '@/lib/hub';
import { AGENT_STATUS, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { INBOX_CHANNEL, InboxPage } from '@/features/inbox/InboxPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { WorkflowsPage } from '@/features/workflows/WorkflowsPage';
import { AgentsPage, AgentDetail } from '@/features/agents/AgentsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { Field, statusDot } from '@/components/shared';

const THEME = { dark: 'dark', light: 'light' } as const;

const iconMap: Record<(typeof PAGE)[keyof typeof PAGE], typeof Inbox> = {
  inbox: Inbox,
  tasks: Columns3,
  workflows: WorkflowIcon,
  agents: Bot,
  settings: Settings,
} as const;

export function App() {
  const h = useHub();
  const { theme, setTheme } = useTheme();
  const { i18n: activeI18n } = useTranslation();
  const [parts, navigate] = useHashRoute();
  const page = parts[0] || PAGE.inbox;
  const [filter, setFilter] = useState<string>(INBOX_CHANNEL.team);
  const needs = waitingOnUser(h.tasks, h.messages);
  const agentPage = page === PAGE.agents && parts[1] ? parts[1] : null;
  const nav = (p: string) => {
    navigate(p);
    setFilter(p === PAGE.inbox ? INBOX_CHANNEL.team : filter);
  };
  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-68 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4">
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Activity size={18} />
          </div>
          <div className="font-semibold tracking-tight">{t('app.brand')}</div>
        </div>
        {h.ws ? <WorkspaceMenu /> : null}
        <div className="mt-5 mb-2 px-2 text-xs tracking-wider text-muted-foreground uppercase">
          {t('workspace.workspace')}
        </div>
        <nav className="grid gap-1">
          {Object.values(PAGE).map((p) => {
            const Icon = iconMap[p];
            const active = page === p;
            return (
              <Button
                key={p}
                variant="ghost"
                onClick={() => nav(p)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'h-9 w-full justify-start gap-2.5 px-2.5 font-normal hover:bg-sidebar-accent',
                  active ? 'bg-sidebar-accent font-medium' : 'text-muted-foreground',
                )}
              >
                <Icon />
                {t(`nav.${p}`)}
                {p === PAGE.inbox && needs.count > 0 && <Badge className="ml-auto">{needs.count}</Badge>}
              </Button>
            );
          })}
        </nav>
        {h.agents.length > 0 && (
          <>
            <div className="mt-7 mb-2 flex items-center justify-between px-2 text-xs tracking-wider text-muted-foreground uppercase">
              <span>{t('agents.title')}</span>
              <Button variant="ghost" size="icon-xs" aria-label={t('agents.addAgent')} onClick={() => nav(PAGE.agents)}>
                <Plus />
              </Button>
            </div>
            <div className="grid gap-1">
              {h.agents.map((a) => (
                <Button
                  key={a.id}
                  variant="ghost"
                  onClick={() => nav(`${PAGE.agents}/${a.id}`)}
                  aria-current={agentPage === a.id ? 'page' : undefined}
                  className={cn(
                    'w-full justify-start gap-2 px-2 font-normal hover:bg-sidebar-accent',
                    agentPage === a.id && 'bg-sidebar-accent',
                  )}
                >
                  <span className={`size-2 rounded-full ${statusDot[agentState(a, h.messages)]}`} />
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {agentState(a, h.messages) === AGENT_STATUS.working ? t('agents.working') : ''}
                  </span>
                </Button>
              ))}
            </div>
          </>
        )}
        <div className="mt-auto">
          <div className="my-3 border-t border-sidebar-border" />
          <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
            <span>{t('common.language')}</span>
            <Select
              value={activeI18n.resolvedLanguage?.startsWith('en') ? 'en' : 'vi'}
              onValueChange={(language) => void activeI18n.changeLanguage(language)}
            >
              <SelectTrigger size="sm" className="ml-auto" aria-label={t('common.language')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vi">{t('common.languageVi')}</SelectItem>
                <SelectItem value="en">{t('common.languageEn')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            onClick={() => setTheme(theme === THEME.dark ? THEME.light : THEME.dark)}
            className="w-full justify-start px-2 font-normal text-muted-foreground"
          >
            {theme === THEME.dark ? <Sun /> : <Moon />} {t('common.toggleTheme')}
          </Button>
          <p className="px-2 text-xs text-muted-foreground">{t('app.avatarLicense')}</p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[1440px] p-7">
          {!h.ready ? (
            <p className="text-muted-foreground">{t('common.loading')}</p>
          ) : !h.ws ? (
            <Welcome />
          ) : page === PAGE.inbox ? (
            <InboxPage filter={filter} setFilter={setFilter} />
          ) : page === PAGE.tasks ? (
            <TasksPage />
          ) : page === PAGE.workflows ? (
            <WorkflowsPage />
          ) : page === PAGE.agents ? (
            agentPage ? (
              <AgentDetail id={agentPage} />
            ) : (
              <AgentsPage />
            )
          ) : (
            <SettingsPage />
          )}
        </div>
      </main>
    </div>
  );
}

function WorkspaceMenu() {
  const h = useHub();
  return (
    <Select value={h.ws?.id} onValueChange={h.selectWorkspace}>
      <SelectTrigger className="w-full" aria-label={t('workspace.workspace')}>
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
  );
}

function Welcome() {
  const h = useHub();
  const [name, setName] = useState(''),
    [repoPath, setRepo] = useState(''),
    [worktreesDir, setTree] = useState('');
  return (
    <div className="mx-auto mt-20 max-w-xl">
      <div className="mb-5 grid size-12 place-items-center rounded-xl bg-primary/15 text-primary">
        <Sparkles />
      </div>
      <h1 className="text-2xl font-semibold">{t('workspace.setUpYourWorkspace')}</h1>
      <p className="mt-2 mb-6 text-muted-foreground">{t('workspace.welcomeDescription')}</p>
      <Card className="grid gap-4 p-5">
        <Field label={t('workspace.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workspace.exampleTeam')} />
        </Field>
        <Field label={t('workspace.repositoryPath')}>
          <Input value={repoPath} onChange={(e) => setRepo(e.target.value)} placeholder="D:\\Projects\\my-repo" />
        </Field>
        <Field label={t('workspace.worktreeDirectory')}>
          <Input
            value={worktreesDir}
            onChange={(e) => setTree(e.target.value)}
            placeholder={t('workspace.worktreePlaceholder')}
          />
        </Field>
        <Button
          onClick={() => h.attempt(() => api.createWorkspace({ name, repoPath, worktreesDir }), t('workspace.created'))}
          disabled={!name.trim()}
        >
          {t('workspace.createWorkspace')}
        </Button>
      </Card>
    </div>
  );
}
