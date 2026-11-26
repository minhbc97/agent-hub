import { SUPPORTED_ENGINES } from '../api/validation.ts';
import { ISOLATIONS, RESET_POLICIES } from '../../shared/contracts.ts';
import { DEFAULT_SETTINGS } from '../db.ts';
import { engineCatalog } from '../engines/catalog.ts';
import { claudeMcpServers } from '../engines/claude-mcp.ts';
import { codexMcpServers } from '../engines/codex.ts';
import { on } from '../http/router.ts';

on('GET', '/api/meta', () => ({
  engines: engineCatalog(SUPPORTED_ENGINES),
  isolations: ISOLATIONS,
  resetPolicies: RESET_POLICIES,
  claudeMcpServers: Object.keys(claudeMcpServers()).sort(),
  codexMcpServers: codexMcpServers().sort(),
  defaults: DEFAULT_SETTINGS,
}));
