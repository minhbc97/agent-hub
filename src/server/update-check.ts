import { readFileSync } from 'node:fs';

const REGISTRY_URL = 'https://registry.npmjs.org/@minhbc/agent-hub/latest';
const REQUEST_TIMEOUT_MS = 5_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DISABLE_ENV = 'AGENT_HUB_NO_UPDATE_CHECK';

function parseVersion(version: string): { parts: bigint[]; isPrerelease: boolean } | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return null;
  return { parts: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])], isPrerelease: !!match[4] };
}

export function isNewer(latest: string, current: string): boolean {
  const latestVersion = parseVersion(latest);
  const currentVersion = parseVersion(current);
  if (!latestVersion || !currentVersion || latestVersion.isPrerelease || currentVersion.isPrerelease) return false;
  for (const [index, part] of latestVersion.parts.entries()) {
    if (part !== currentVersion.parts[index]) return part > currentVersion.parts[index];
  }
  return false;
}

export function parseLatest(json: unknown): string | null {
  if (!json || typeof json !== 'object' || !('version' in json)) return null;
  const version = json.version;
  return typeof version === 'string' && parseVersion(version) ? version : null;
}

function readCurrentVersion(): string {
  const packageJson: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  if (!packageJson || typeof packageJson !== 'object' || !('version' in packageJson)) {
    throw new Error('Package version is missing.');
  }
  const version = packageJson.version;
  if (typeof version !== 'string' || !parseVersion(version)) throw new Error('Package version is invalid.');
  return version;
}

export const currentVersion = readCurrentVersion();
let latestVersion: string | null = null;
let lastCheckedAt = 0;
let pendingCheck: Promise<void> | null = null;

export function getLatestVersion(): string | null {
  return process.env[DISABLE_ENV] === '1' || !latestVersion || !isNewer(latestVersion, currentVersion)
    ? null
    : latestVersion;
}

export function checkForUpdate(): Promise<void> {
  if (process.env[DISABLE_ENV] === '1' || Date.now() - lastCheckedAt < CHECK_INTERVAL_MS) {
    return pendingCheck ?? Promise.resolve();
  }
  if (pendingCheck) return pendingCheck;

  lastCheckedAt = Date.now();
  pendingCheck = (async () => {
    try {
      const response = await fetch(REGISTRY_URL, { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error('Registry request failed.');
      const latest = parseLatest(await response.json());
      latestVersion = latest && isNewer(latest, currentVersion) ? latest : null;
    } catch {
      console.warn('Could not check for updates.');
    } finally {
      pendingCheck = null;
    }
  })();
  return pendingCheck;
}
