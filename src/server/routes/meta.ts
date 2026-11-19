import { SUPPORTED_ENGINES } from '../api/validation.ts';
import { ISOLATIONS, RESET_POLICIES } from '../../shared/contracts.ts';
import { DEFAULT_SETTINGS } from '../db.ts';
import { engineCatalog } from '../engines/catalog.ts';
import { on } from '../http/router.ts';

on('GET', '/api/meta', () => ({
  engines: engineCatalog(SUPPORTED_ENGINES),
  isolations: ISOLATIONS,
  resetPolicies: RESET_POLICIES,
  defaults: DEFAULT_SETTINGS,
}));
