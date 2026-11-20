import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '../../shared/contracts.ts';
import { DATA_DIR } from '../db.ts';

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const USER_CONFIG = process.env.CLAUDE_CONFIG_DIR ? join(CLAUDE_HOME, '.claude.json') : join(homedir(), '.claude.json');
const PLUGINS_DIR = join(CLAUDE_HOME, 'plugins');

type Config = Record<string, unknown>;

const isRecord = (x: unknown): x is Config => !!x && typeof x === 'object' && !Array.isArray(x);

function readJson(file: string): Config | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const subdirs = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(dir, d.name))
    : [];

/** Installed plugins plus the ones synced from claude.ai (each sync is a folder of plugin folders). */
function pluginDirs(): string[] {
  const installed = readJson(join(PLUGINS_DIR, 'installed_plugins.json'))?.plugins;
  const fromManifest = isRecord(installed)
    ? Object.values(installed).flatMap((versions) =>
        Array.isArray(versions) ? versions.map((v) => (isRecord(v) ? String(v.installPath ?? '') : '')) : [],
      )
    : [];
  return [...fromManifest.filter(Boolean), ...subdirs(join(PLUGINS_DIR, 'synced')).flatMap(subdirs)];
}

/**
 * MCP servers Claude Code would load from the user's config and plugins, keyed by the name Claude gives them.
 * Keeping that name matters: Claude keys its saved OAuth sign-in by it, so a lean run stays signed in.
 */
export function claudeMcpServers(): Record<string, Config> {
  const servers: Record<string, Config> = {};
  const user = readJson(USER_CONFIG)?.mcpServers;
  if (isRecord(user)) for (const [name, config] of Object.entries(user)) if (isRecord(config)) servers[name] = config;
  for (const dir of pluginDirs()) {
    const manifest = readJson(join(dir, '.claude-plugin', 'plugin.json'));
    if (typeof manifest?.name !== 'string') continue;
    // Plugins declare servers either wrapped in "mcpServers" or as the file's top level.
    const file = readJson(join(dir, '.mcp.json')) ?? (isRecord(manifest.mcpServers) ? manifest.mcpServers : null);
    const entries = isRecord(file?.mcpServers) ? file.mcpServers : file;
    if (!entries) continue;
    for (const [name, config] of Object.entries(entries)) {
      if (!isRecord(config)) continue;
      // Outside the plugin, Claude cannot expand its root variable, so resolve it here.
      const resolved = JSON.parse(
        JSON.stringify(config).replaceAll('${CLAUDE_PLUGIN_ROOT}', dir.replaceAll('\\', '/')),
      );
      servers[`plugin:${manifest.name}:${name}`] = resolved;
    }
  }
  return servers;
}

/** Tool-permission prefix Claude uses for a server's tools (`mcp__<name>__<tool>`). */
export const mcpToolPrefix = (name: string) => `mcp__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

/** Write the agent's picked servers to a config file for `--mcp-config`; servers no longer installed are skipped. */
export function writeMcpConfig(agent: Agent): string {
  const all = claudeMcpServers();
  const mcpServers = Object.fromEntries(agent.mcpServers.filter((name) => all[name]).map((name) => [name, all[name]]));
  const dir = join(DATA_DIR, 'mcp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${agent.id}.json`);
  writeFileSync(file, JSON.stringify({ mcpServers }, null, 2));
  return file;
}
