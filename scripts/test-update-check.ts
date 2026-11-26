import assert from 'node:assert/strict';
import { checkForUpdate, getLatestVersion, isNewer, parseLatest } from '../src/server/update-check.ts';

assert.equal(isNewer('0.3.1', '0.3.0'), true);
assert.equal(isNewer('0.4.0', '0.3.9'), true);
assert.equal(isNewer('1.0.0', '0.9.0'), true);
assert.equal(isNewer('0.3.0', '0.3.0'), false);
assert.equal(isNewer('1.0.0-beta.1', '0.9.0'), false);
assert.equal(isNewer('1.0.0', '1.0.0-beta.1'), false);
assert.equal(parseLatest({ version: '1.2.3' }), '1.2.3');
assert.equal(parseLatest(null), null);
assert.equal(parseLatest({}), null);
assert.equal(parseLatest({ version: 123 }), null);
assert.equal(parseLatest({ version: 'invalid' }), null);

const originalFetch = globalThis.fetch;
process.env.AGENT_HUB_NO_UPDATE_CHECK = '1';
globalThis.fetch = async () => {
  throw new Error('Disabled update checks must not make requests.');
};
await checkForUpdate();
assert.equal(getLatestVersion(), null);
globalThis.fetch = originalFetch;
delete process.env.AGENT_HUB_NO_UPDATE_CHECK;

console.log('Update check tests passed');
