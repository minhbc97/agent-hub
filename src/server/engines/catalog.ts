import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE, ENGINES, type Engine, type EngineInfo, type EngineModel } from '../../shared/contracts.ts';
import { DATA_DIR } from '../db.ts';
import { OPENROUTER_API_KEY_ENV } from './openrouter.ts';

/** Edit this file to add or replace models per engine without a code change: {"claude":[{"id":"...","label":"..."}]} */
const MODELS_OVERRIDE_FILE = join(DATA_DIR, 'models.json');
const WHICH_TIMEOUT_MS = 3000;

/**
 * Built-in lists are a floor so the picker is never empty; the model field stays free text, so an outdated
 * list only costs a typed id. Empty model id = the CLI's own default (not listed here, the UI adds it).
 */
const BUILT_IN: Record<Engine, Omit<EngineInfo, 'id' | 'supported' | 'installed' | 'configured'>> = {
  [ENGINE.claude]: {
    label: 'Claude Code',
    defaultCommand: 'claude',
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    loginCommand: 'claude',
    // Headless turns cannot answer permission prompts.
    defaultExtraArgs: '--permission-mode acceptEdits',
    models: [
      { id: 'claude-fable-5-2', label: 'Fable 5.2' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    ],
  },
  [ENGINE.codex]: {
    label: 'Codex',
    defaultCommand: 'codex',
    installUrl: 'https://developers.openai.com/codex/cli',
    loginCommand: 'codex login',
    // codex exec is read-only by default; agents must edit files and write to their outbox.
    // On Windows the "elevated" sandbox hangs every shell command when its admin setup is missing; the unelevated
    // one works without setup. Set per agent so the user's global ~/.codex/config.toml stays untouched.
    defaultExtraArgs:
      '-c sandbox_mode="workspace-write"' + (process.platform === 'win32' ? ' -c windows.sandbox="unelevated"' : ''),
    models: [
      { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
      { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ],
  },
  [ENGINE.antigravity]: {
    label: 'Antigravity',
    defaultCommand: 'agy',
    installUrl: 'https://antigravity.google/docs/cli/install',
    // The first run asks for a Google sign-in; there is no separate login command.
    loginCommand: 'agy',
    defaultExtraArgs: '--mode accept-edits',
    models: [
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash · Medium' },
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash · High' },
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro · High' },
    ],
  },
  [ENGINE.openrouter]: {
    label: 'OpenRouter',
    defaultCommand: '',
    defaultExtraArgs: '',
    installUrl: null,
    loginCommand: null,
    models: [],
  },
  [ENGINE.custom]: {
    label: 'Custom',
    defaultCommand: '',
    defaultExtraArgs: '',
    installUrl: null,
    loginCommand: null,
    models: [],
  },
};

export function engineCatalog(supported: readonly Engine[]): EngineInfo[] {
  const overrides = readOverrides();
  return ENGINES.map((id) => {
    const base = BUILT_IN[id];
    return {
      id,
      label: base.label,
      supported: supported.includes(id),
      defaultCommand: base.defaultCommand,
      defaultExtraArgs: base.defaultExtraArgs,
      installUrl: base.installUrl,
      loginCommand: base.loginCommand,
      installed: id === ENGINE.openrouter ? null : base.defaultCommand ? isOnPath(base.defaultCommand) : null,
      configured: id === ENGINE.openrouter ? Boolean(process.env[OPENROUTER_API_KEY_ENV]?.trim()) : null,
      models: overrides[id] ?? base.models,
    };
  });
}

/** A broken override file must not empty the pickers: invalid content falls back to the built-in lists. */
function readOverrides(): Partial<Record<Engine, EngineModel[]>> {
  if (!existsSync(MODELS_OVERRIDE_FILE)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(MODELS_OVERRIDE_FILE, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    console.error(`ignoring ${MODELS_OVERRIDE_FILE}: ${(err as Error).message}`);
    return {};
  }
  return parseOverrides(raw);
}

export function parseOverrides(raw: unknown): Partial<Record<Engine, EngineModel[]>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<Engine, EngineModel[]>> = {};
  for (const engine of ENGINES) {
    const list = (raw as Record<string, unknown>)[engine];
    if (!Array.isArray(list)) continue;
    const models = list.flatMap((m): EngineModel[] => {
      if (!m || typeof m !== 'object') return [];
      const { id, label } = m as Record<string, unknown>;
      if (typeof id !== 'string' || !id.trim()) return [];
      return [{ id: id.trim(), label: typeof label === 'string' && label.trim() ? label.trim() : id.trim() }];
    });
    if (models.length) out[engine] = models;
  }
  return out;
}

/** null = could not tell; the UI never blocks on that, it only shows a hint for a proven miss. */
function isOnPath(binary: string): boolean | null {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [binary], {
      stdio: 'ignore',
      timeout: WHICH_TIMEOUT_MS,
      windowsHide: true,
    });
    return true;
  } catch (err) {
    // where/which exit 1 when the binary is missing; anything else (timeout, no `which`) is unknown.
    return (err as { status?: number }).status === 1 ? false : null;
  }
}

/** Command and flags an agent borrows when it runs on another engine than its own (its fallback). */
export function engineDefaults(engine: Engine): Pick<EngineInfo, 'defaultCommand' | 'defaultExtraArgs'> {
  const { defaultCommand, defaultExtraArgs } = BUILT_IN[engine];
  return { defaultCommand, defaultExtraArgs };
}
