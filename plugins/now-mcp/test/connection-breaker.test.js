import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceNowClient } from '../build/client/servicenow-client.js';

let calls;
let savedEnv;

function response(status, body = { error: { message: 'denied' } }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'OK',
    headers: { forEach: () => {} },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function client() {
  return new ServiceNowClient('https://dev123.service-now.com', {
    type: 'basic',
    username: 'api.user',
    password: 'stale',
  });
}

beforeEach(() => {
  calls = 0;
  savedEnv = {
    auth: process.env.SERVICENOW_BREAKER_AUTH_THRESHOLD,
    generic: process.env.SERVICENOW_BREAKER_THRESHOLD,
    cooldown: process.env.SERVICENOW_BREAKER_COOLDOWN_MS,
  };
  process.env.SERVICENOW_BREAKER_AUTH_THRESHOLD = '2';
  process.env.SERVICENOW_BREAKER_THRESHOLD = '5';
  process.env.SERVICENOW_BREAKER_COOLDOWN_MS = '30000';
});

afterEach(() => {
  delete globalThis.fetch;
  for (const [key, value] of Object.entries({
    SERVICENOW_BREAKER_AUTH_THRESHOLD: savedEnv.auth,
    SERVICENOW_BREAKER_THRESHOLD: savedEnv.generic,
    SERVICENOW_BREAKER_COOLDOWN_MS: savedEnv.cooldown,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('repeated Basic-auth 401s open the instance breaker and then block locally', async () => {
  globalThis.fetch = async () => {
    calls += 1;
    return response(401);
  };
  const sn = client();

  await assert.rejects(sn.get('/api/now/table/incident'), (error) => error.statusCode === 401);
  await assert.rejects(sn.get('/api/now/table/incident'), (error) => error.statusCode === 401);
  assert.equal(calls, 2);
  assert.equal(sn.getConnectionStatus().state, 'open');
  assert.equal(sn.getConnectionStatus().openedReason, 'repeated_authentication_failures');

  await assert.rejects(sn.get('/api/now/table/task'), (error) => {
    assert.equal(error.code, 'CIRCUIT_OPEN');
    assert.equal(error.servicenowError.scope, 'instance');
    assert.equal(error.servicenowError.authType, 'basic');
    assert.ok(error.servicenowError.retryAfterMs > 0);
    return true;
  });
  assert.equal(calls, 2, 'open breaker must reject without fetch');
});

test('403 is authorization failure and does not open the authentication breaker', async () => {
  globalThis.fetch = async () => {
    calls += 1;
    return response(403);
  };
  const sn = client();

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(sn.get('/api/now/table/sn_grc_indicator'), (error) => error.statusCode === 403);
  }

  assert.equal(calls, 3);
  assert.equal(sn.getConnectionStatus().state, 'closed');
  assert.equal(sn.getConnectionStatus().authFailureScore, 0);
});

test('resetConnection permits an immediate request after configuration repair', async () => {
  globalThis.fetch = async () => {
    calls += 1;
    return response(401);
  };
  const sn = client();
  await assert.rejects(sn.get('/api/now/table/incident'));
  await assert.rejects(sn.get('/api/now/table/incident'));
  assert.equal(sn.getConnectionStatus().state, 'open');

  assert.equal(sn.resetConnection().state, 'closed');
  globalThis.fetch = async () => {
    calls += 1;
    return response(200, { result: [] });
  };

  assert.deepEqual(await sn.get('/api/now/table/incident'), { result: [] });
  assert.equal(calls, 3);
});