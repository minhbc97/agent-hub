import { SUPPORTED_ENGINES } from '../api/validation.ts';
import { engineCatalog } from '../engines/catalog.ts';
import { on } from '../http/router.ts';
import { usageReport } from '../usage.ts';

on('GET', '/api/usage', (req) => {
  const refresh = new URL(req.url ?? '/', 'http://localhost').searchParams.has('refresh');
  return usageReport(engineCatalog(SUPPORTED_ENGINES), refresh);
});
