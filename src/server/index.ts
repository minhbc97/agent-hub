import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { openDb } from './db.ts';
import { startBus } from './bus.ts';
import { handleApi } from './api.ts';
import { removeAllMcpConfigs } from './engines/claude-mcp.ts';

const PORT = Number(process.env.HUB_PORT ?? 4310);
const PROD = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
let ui: Middleware;

if (PROD) {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/ is missing. Run "npm run build" first.');
    process.exit(1);
  }
  ui = serveStatic;
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    configFile: join(ROOT, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  ui = vite.middlewares as unknown as Middleware;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    // A malformed %-escape throws URIError; unhandled, it would take the whole hub down.
    res.writeHead(400).end('bad request');
    return;
  }
  let file = resolve(DIST, '.' + path);
  if (!file.startsWith(DIST + sep) || !existsSync(file) || statSync(file).isDirectory())
    file = join(DIST, 'index.html');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  ui(req, res, () => res.writeHead(404).end('not found'));
});

// Exit through process.exit so the running CLIs are ended with the hub.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(0));

openDb();
removeAllMcpConfigs();
startBus();
// Loopback only: the hub runs commands on this machine.
server.listen(PORT, '127.0.0.1', () =>
  console.log(`agent-hub ${PROD ? '(prod)' : '(dev)'} on http://127.0.0.1:${PORT}`),
);
