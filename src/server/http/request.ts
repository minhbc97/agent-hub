import type { IncomingMessage } from 'node:http';
import { HttpError } from './errors.ts';

export async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 1_000_000) throw new HttpError(413, 'errors.bodyTooLarge');
  }
  try {
    const v = s ? JSON.parse(s) : {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'errors.invalidJson');
  }
}

export const str = (v: unknown) => (typeof v === 'string' ? v : '');
