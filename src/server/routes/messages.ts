import { HttpError } from '../http/errors.ts';
import { body, str } from '../http/request.ts';
import { needWorkspace } from '../api/validation.ts';
import { listMessages, tokenTotals, getTask } from '../db.ts';
import { retryMessage, sendFromUser, tick } from '../bus.ts';
import { hubEvents, type HubEvent } from '../events.ts';
import { HANDLED, on } from '../http/router.ts';

on('GET', '/api/workspaces/:ws/messages', (_q, _r, p) => listMessages(needWorkspace(p.ws!).id));

on('POST', '/api/workspaces/:ws/messages', async (req, _r, p) => {
  const ws = needWorkspace(p.ws!);
  const b = await body(req);
  const to = str(b.to);
  const text = str(b.body);
  if (!to || !text.trim()) throw new HttpError(400, 'errors.recipientAndBodyRequired');
  const taskId = str(b.taskId) || null;
  if (taskId && getTask(taskId)?.workspaceId !== ws.id) throw new HttpError(400, 'errors.taskNotFound');
  const msg = sendFromUser(ws.id, to, text, { subject: str(b.subject), urgent: !!b.urgent, taskId });
  tick();
  return msg;
});

on('POST', '/api/messages/:id/retry', (_q, _r, p) => retryMessage(p.id!));

on('GET', '/api/workspaces/:ws/tokens', (_q, _r, p) => {
  const ws = needWorkspace(p.ws!);
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return tokenTotals(ws.id, day.toISOString());
});

on('GET', '/api/events', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const send = (e: HubEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  hubEvents.on('change', send);
  req.on('close', () => {
    clearInterval(ping);
    hubEvents.off('change', send);
  });
  return HANDLED;
});
