import { useState } from 'react';
import { Check } from 'lucide-react';
import { useHub } from '@/lib/hub';
import { api, MCP_ENGINES, MCP_TRANSPORT, type Engine, type McpTransport } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/shared';

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** `KEY=value` per line; null while a line has no `=`. */
function parseEnv(text: string): Record<string, string> | null {
  const pairs = lines(text).map((line) => {
    const at = line.indexOf('=');
    return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : null;
  });
  return pairs.every((pair) => pair !== null) ? Object.fromEntries(pairs) : null;
}

/** Adds a server to the user-level MCP config of the picked CLIs, through their own `mcp add`. */
export function McpServerDialog({
  open,
  engine,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  engine: Engine;
  onOpenChange: (open: boolean) => void;
  onAdded: (name: string, engines: Engine[]) => void;
}) {
  const h = useHub();
  const installed = MCP_ENGINES.filter((id) => h.meta?.engines.find((e) => e.id === id)?.installed !== false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransport>(MCP_TRANSPORT.stdio);
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [envText, setEnvText] = useState('');
  const [url, setUrl] = useState('');
  const [engines, setEngines] = useState<Engine[]>(installed.includes(engine) ? [engine] : installed);
  const [isBusy, setIsBusy] = useState(false);
  const isHttp = transport === MCP_TRANSPORT.http;
  const env = parseEnv(envText);
  const canAdd =
    !isBusy && !!name.trim() && engines.length > 0 && (isHttp ? !!url.trim() : !!command.trim() && env !== null);

  const add = async () => {
    setIsBusy(true);
    const server = {
      name: name.trim(),
      transport,
      command: command.trim(),
      args: lines(args),
      env: env ?? {},
      url: url.trim(),
      engines,
    };
    const done = await h.attempt(() => api.addMcpServer(server), t('agents.mcpServerAdded', { name: server.name }));
    setIsBusy(false);
    if (done === undefined) return;
    await h.reloadMeta().catch(() => {});
    onAdded(server.name, engines);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('agents.addMcpServer')}</DialogTitle>
          <DialogDescription>{t('agents.addMcpServerDescription')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canAdd) void add();
          }}
        >
          <Field label={t('common.name')} isRequired>
            <Input required placeholder="jira" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">{t('agents.mcpTransport')}</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="justify-start"
              value={transport}
              onValueChange={(x) => x && setTransport(x as McpTransport)}
            >
              <ToggleGroupItem value={MCP_TRANSPORT.stdio}>
                {!isHttp && <Check />}
                {t('agents.mcpTransportStdio')}
              </ToggleGroupItem>
              <ToggleGroupItem value={MCP_TRANSPORT.http}>
                {isHttp && <Check />}
                {t('agents.mcpTransportHttp')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {isHttp ? (
            <>
              <Field label={t('agents.mcpUrl')} isRequired>
                <Input
                  required
                  type="url"
                  placeholder="https://mcp.example.com/mcp"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <p className="-mt-2 text-xs/5 text-muted-foreground">
                {t('agents.mcpLoginHint', { name: name.trim() || '<name>' })}
              </p>
            </>
          ) : (
            <>
              <Field label={t('agents.mcpCommand')} isRequired>
                <Input required placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} />
              </Field>
              <Field label={t('agents.mcpArgs')}>
                <Textarea
                  rows={3}
                  placeholder={'-y\n@example/mcp-server'}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                />
              </Field>
              <Field label={t('agents.mcpEnv')}>
                <Textarea
                  rows={2}
                  placeholder="API_KEY=..."
                  value={envText}
                  aria-invalid={env === null}
                  onChange={(e) => setEnvText(e.target.value)}
                />
              </Field>
              <p className="-mt-2 text-xs/5 text-muted-foreground">{t('agents.mcpEnvHint')}</p>
            </>
          )}
          <div className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">{t('agents.mcpEngines')}</span>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              className="justify-start"
              value={engines}
              onValueChange={(x) => setEngines(MCP_ENGINES.filter((id) => x.includes(id)))}
            >
              {installed.map((id) => (
                <ToggleGroupItem key={id} value={id}>
                  {engines.includes(id) && <Check />}
                  {h.meta?.engines.find((e) => e.id === id)?.label ?? id}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <Button type="submit" disabled={!canAdd}>
            {t('agents.addMcpServer')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
