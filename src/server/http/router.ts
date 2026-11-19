import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.ts';
import { DomainError } from '../domain-error.ts';

type Params = Record<string, string>;

type Handler = (req: IncomingMessage, res: ServerResponse, p: Params) => unknown | Promise<unknown>;

const routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];

export const HANDLED = Symbol('handled');

/** Host names the hub answers on; it only listens on 127.0.0.1. */
const LOOPBACK_NAMES = ['127.0.0.1', 'localhost'];

export function on(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, h });
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return false;
  if (!isLoopbackHost(req)) {
    json(res, 403, { error: 'host not allowed', errorKey: 'errors.hostNotAllowed' });
    return true;
  }
  const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route) {
    json(res, 404, { error: 'not found', errorKey: 'errors.routeNotFound' });
    return true;
  }
  if (req.method !== 'GET' && !sameOrigin(req)) {
    json(res, 403, {
      error: 'cross-origin request refused',
      errorKey: 'errors.crossOriginBlocked',
    });
    return true;
  }
  const m = url.pathname.match(route.re)!;
  try {
    // Inside try: a malformed %-escape throws URIError, which would otherwise kill the process.
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
    const out = await route.h(req, res, params);
    if (out !== HANDLED) json(res, 200, out ?? null);
  } catch (err) {
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message, errorKey: err.key, errorParams: err.params });
    } else if (err instanceof DomainError) {
      json(res, 400, { error: err.message, errorKey: err.key, errorParams: err.params });
    } else if (err instanceof URIError) {
      json(res, 400, { error: 'invalid path', errorKey: 'errors.invalidPath' });
    } else {
      console.error(err);
      json(res, 500, { error: 'Internal server error', errorKey: 'errors.internalServerError' });
    }
  }
  return true;
}

/**
 * DNS rebinding guard: a hostile page can point its own domain at 127.0.0.1, which makes Origin and Host match.
 * Only accept requests addressed to the loopback names this server actually answers on.
 */
function isLoopbackHost(req: IncomingMessage): boolean {
  const port = req.socket.localPort;
  return LOOPBACK_NAMES.some((name) => req.headers.host === `${name}:${port}`);
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, scripts
  try {
    const host = new URL(origin).host;
    return host === req.headers.host;
  } catch {
    return false;
  }
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
}
