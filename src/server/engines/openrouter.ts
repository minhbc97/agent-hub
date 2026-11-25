import type { Agent } from '../db.ts';
import { EMPTY_USAGE, type EngineAdapter, type TurnResult } from './types.ts';

const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_API_KEY_ENV = 'OPENROUTER_API_KEY';

/** Text-only provider adapter. OpenRouter API calls do not expose workspace tools in this first version. */
export const openrouter: EngineAdapter = {
  command: () => '',
  parse: (stdout, stderr, exitCode) => ({
    text: stdout.trim() || stderr.trim() || `OpenRouter request failed with code ${exitCode}`,
    sessionId: null,
    usage: EMPTY_USAGE,
    isError: exitCode !== 0,
  }),
  run: async (agent: Agent, prompt: string, signal: AbortSignal): Promise<TurnResult> => {
    const apiKey = process.env[OPENROUTER_API_KEY_ENV]?.trim();
    if (!apiKey) return failure('Set OPENROUTER_API_KEY in the agent-hub server environment.');
    if (!agent.model.trim()) return failure('Choose an OpenRouter model before running this agent.');

    let response: Response;
    let raw: string;
    try {
      response = await fetch(CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: agent.model, messages: [{ role: 'user', content: prompt }] }),
        signal,
      });
      raw = await response.text();
    } catch (error) {
      return failure(
        error instanceof Error && error.name === 'TimeoutError'
          ? 'OpenRouter request timed out.'
          : 'Could not reach OpenRouter.',
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return failure(`OpenRouter returned an invalid response (${response.status}).`);
    }
    if (!response.ok)
      return failure(
        errorMessage(payload).replaceAll(apiKey, '[redacted]') || `OpenRouter request failed (${response.status}).`,
      );
    return parseCompletion(payload);
  },
};

export function parseCompletion(payload: unknown): TurnResult {
  if (!isRecord(payload)) return failure('OpenRouter returned an invalid response.');
  const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0]) ? payload.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const text = typeof message?.content === 'string' ? message.content : '';
  if (!text) return failure('OpenRouter returned no text response.');
  const usage = isRecord(payload.usage) ? payload.usage : {};
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const cacheReadTokens = numberValue(promptDetails.cached_tokens);
  return {
    text,
    sessionId: null,
    usage: {
      inputTokens: Math.max(0, numberValue(usage.prompt_tokens) - cacheReadTokens),
      outputTokens: numberValue(usage.completion_tokens),
      cacheWriteTokens: numberValue(promptDetails.cache_write_tokens),
      cacheReadTokens,
      costUsd: numberValue(usage.cost),
    },
    isError: false,
  };
}

export function parseTaskReply(text: string): { act: 'done'; body: string } | { act: 'needs_human'; body: string } {
  try {
    const payload: unknown = JSON.parse(text.trim());
    if (isRecord(payload) && payload.act === 'needs_human' && typeof payload.body === 'string' && payload.body.trim()) {
      return { act: 'needs_human', body: payload.body.trim() };
    }
  } catch {
    // Most model replies are plain text; only the explicit JSON form represents a request for a human.
  }
  return { act: 'done', body: text };
}

function errorMessage(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.error)) return '';
  return typeof payload.error.message === 'string' ? payload.error.message : '';
}

function failure(text: string): TurnResult {
  return { text, sessionId: null, usage: EMPTY_USAGE, isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
