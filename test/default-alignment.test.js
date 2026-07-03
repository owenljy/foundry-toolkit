import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDefaultAlignment } from '../build/utils/now-sdk-cli.js';

const CONFIGURED = [
  { name: '152992', url: 'https://demoalectriallwfaa152992.service-now.com/' },
  { name: 'dsta-demo', url: 'https://demoalectriallwfzj147775.service-now.com/' },
];

const dstaProfile = {
  alias: 'dsta',
  host: 'https://demoalectriallwfzj147775.service-now.com/',
  isDefault: true,
};

test('misaligned: now-sdk default differs from MCP default → recommend the switch', () => {
  const r = deriveDefaultAlignment(dstaProfile, CONFIGURED, '152992', true);
  assert.equal(r.defaultAligned, false);
  assert.equal(r.recommendedDefaultInstance, 'dsta-demo');
  assert.equal(r.nowSdkDefaultProfile, 'dsta');
  assert.equal(r.mcpDefaultInstance, '152992');
});

test('aligned: MCP default already matches now-sdk → no recommendation', () => {
  const r = deriveDefaultAlignment(dstaProfile, CONFIGURED, 'dsta-demo', true);
  assert.equal(r.defaultAligned, true);
  assert.equal(r.recommendedDefaultInstance, null);
});

test('now-sdk unavailable → indeterminate, never nags', () => {
  const r = deriveDefaultAlignment(null, CONFIGURED, '152992', false);
  assert.equal(r.nowSdkAvailable, false);
  assert.equal(r.defaultAligned, true);
  assert.equal(r.recommendedDefaultInstance, null);
});

test('now-sdk default host matches no configured instance → indeterminate', () => {
  const stranger = { alias: 'other', host: 'https://dev999999.service-now.com/', isDefault: true };
  const r = deriveDefaultAlignment(stranger, CONFIGURED, '152992', true);
  assert.equal(r.defaultAligned, true);
  assert.equal(r.recommendedDefaultInstance, null);
  assert.equal(r.nowSdkDefaultHost, 'https://dev999999.service-now.com/');
});

test('host comparison ignores protocol and trailing slash', () => {
  const noSlash = { alias: 'dsta', host: 'http://demoalectriallwfzj147775.service-now.com', isDefault: true };
  const r = deriveDefaultAlignment(noSlash, CONFIGURED, '152992', true);
  assert.equal(r.recommendedDefaultInstance, 'dsta-demo');
});
