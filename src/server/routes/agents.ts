import { ACT, AGENT_STATUS } from '../../shared/contracts.ts';
import { HttpError } from '../http/errors.ts';
import { body } from '../http/request.ts';
import { SUPPORTED_ENGINES, needWorkspace, needAgent, agentFields } from '../api/validation.ts';
import { createAgent, deleteAgent, getAgent, listAgents, listRuns, updateAgent } from '../db.ts';
import { isAgentRunning, sendFromUser, tick } from '../bus.ts';
import { emit } from '../events.ts';
import { resetSession, stopTurn } from '../runner.ts';
import { on } from '../http/router.ts';

on('GET', '/api/workspaces/:ws/agents', (_q, _r, p) => listAgents(needWorkspace(p.ws!).id));

on('POST', '/api/workspaces/:ws/agents', async (req, _r, p) => {
  const ws = needWorkspace(p.ws!);
  const fields = agentFields(await body(req), ws.id, null);
  if (!fields.name) throw new HttpError(400, 'errors.agentNameRequired');
  const agent = createAgent({
    ...fields,
    workspaceId: ws.id,
    name: fields.name,
  });
  emit({ type: 'agent', workspaceId: ws.id, id: agent.id });
  return getAgent(agent.id);
});

on('PATCH', '/api/agents/:id', async (req, _r, p) => {
  const agent = needAgent(p.id!);
  const fields = agentFields(await body(req), agent.workspaceId, agent);
  const engineChanged = fields.engine !== undefined && fields.engine !== agent.engine;
  // A finishing turn would store the old engine's session id after the switch.
  if (engineChanged && isAgentRunning(agent.id)) throw new HttpError(409, 'errors.agentRunningCannotSwitchEngine');
  // Session ids belong to one CLI; resuming another engine with it fails at start.
  updateAgent(agent.id, engineChanged ? { ...fields, sessionId: null, turnsInSession: 0, activeEngine: null } : fields);
  if (fields.paused !== undefined && !isAgentRunning(agent.id)) {
    updateAgent(agent.id, { status: fields.paused ? AGENT_STATUS.paused : AGENT_STATUS.idle });
  }
  emit({ type: 'agent', workspaceId: agent.workspaceId, id: agent.id });
  tick();
  return getAgent(agent.id);
});

on('DELETE', '/api/agents/:id', (_q, _r, p) => {
  const agent = needAgent(p.id!);
  if (isAgentRunning(agent.id)) throw new HttpError(409, 'errors.agentRunningCannotDelete');
  // Every workspace must keep a lead agent; the UI would immediately force creating another one.
  if (agent.isOrchestrator) throw new HttpError(409, 'errors.orchestratorCannotDelete');
  deleteAgent(agent.id);
  emit({ type: 'agent', workspaceId: agent.workspaceId });
  return { ok: true };
});

on('POST', '/api/agents/:id/new-session', (_q, _r, p) => {
  const agent = needAgent(p.id!);
  resetSession(agent.id);
  emit({ type: 'agent', workspaceId: agent.workspaceId, id: agent.id });
  return getAgent(agent.id);
});

on('POST', '/api/agents/:id/stop', (_q, _r, p) => {
  if (!stopTurn(needAgent(p.id!).id)) throw new HttpError(409, 'errors.agentNotRunning');
  return { ok: true };
});

on('POST', '/api/agents/:id/test', (_q, _r, p) => {
  const agent = needAgent(p.id!);
  if (!SUPPORTED_ENGINES.includes(agent.engine))
    throw new HttpError(400, 'errors.engineUnsupported', {
      engine: agent.engine,
    });
  const msg = sendFromUser(
    agent.workspaceId,
    agent.name,
    'Connection test from agent-hub. Reply with one short sentence: your name and role. Do not write any files.',
    {
      subject: 'test',
      act: ACT.query,
    },
  );
  tick();
  return msg;
});

on('GET', '/api/agents/:id/runs', (_q, _r, p) => listRuns(needAgent(p.id!).id));
