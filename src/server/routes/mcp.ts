import { mcpServerFields } from '../api/validation.ts';
import { body } from '../http/request.ts';
import { on } from '../http/router.ts';
import { addMcpServer } from '../mcp-add.ts';

on('POST', '/api/mcp-servers', async (req) => {
  await addMcpServer(mcpServerFields(await body(req)));
  return null;
});
