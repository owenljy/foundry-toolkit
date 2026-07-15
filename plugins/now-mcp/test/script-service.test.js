import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScriptService } from '../build/services/script-service.js';
import { ServiceNowError } from '../build/types/errors.js';

function manager(client, config = {}) {
  const resolved = { name: 'dev', readOnly: false, ...config };
  return {
    getClient: () => client,
    getConfig: () => resolved,
    getConfigSource: () => ({ kind: 'env' }),
  };
}

function apiError(message = 'Requested URI does not represent any resource') {
  return new ServiceNowError(message, 404, undefined, 'NOT_FOUND');
}

test('Scripted REST 404 identifies the configured endpoint and remediation', async () => {
  const client = { post: async () => { throw apiError(); } };
  const service = new ScriptService(manager(client, { scriptApiPath: '/api/x_acme/scripts/run' }));

  await assert.rejects(
    service.executeBackgroundScript("gs.info('hello')"),
    (error) => {
      assert.equal(error.code, 'BACKGROUND_SCRIPT_TRANSPORT_ERROR');
      assert.equal(error.statusCode, 404);
      assert.match(error.message, /Scripted REST execution failed/);
      assert.match(error.message, /POST \/api\/x_acme\/scripts\/run/);
      assert.match(error.message, /installed, active Scripted REST resource/);
      return true;
    },
  );
});

test('Scripted REST response contract is validated', async () => {
  const client = { post: async () => ({ result: { output: 'missing success' } }) };
  const service = new ScriptService(manager(client, { scriptApiPath: '/api/x_acme/scripts/run' }));

  await assert.rejects(service.executeBackgroundScript('1 + 1'), (error) => {
    assert.equal(error.code, 'BACKGROUND_SCRIPT_INVALID_RESPONSE');
    assert.match(error.message, /expected \{ result: \{ success: boolean/);
    return true;
  });
});

test('mailbox creation failure identifies sys_properties and its access prerequisite', async () => {
  const client = { post: async () => { throw apiError(); } };
  const service = new ScriptService(manager(client));

  await assert.rejects(service.executeBackgroundScript('1 + 1'), (error) => {
    assert.equal(error.statusCode, 404);
    assert.match(error.message, /mailbox creation failed/);
    assert.match(error.message, /POST \/api\/now\/table\/sys_properties/);
    assert.match(error.message, /Configure a working scriptApiPath/);
    return true;
  });
});

test('trigger creation failure identifies sys_trigger and cleans up the mailbox', async () => {
  const deleted = [];
  const client = {
    async post(endpoint) {
      if (endpoint.endsWith('sys_properties')) return { result: { sys_id: 'prop-id' } };
      throw apiError();
    },
    async delete(endpoint) { deleted.push(endpoint); },
  };
  const service = new ScriptService(manager(client));

  await assert.rejects(service.executeBackgroundScript('1 + 1'), (error) => {
    assert.match(error.message, /trigger creation failed/);
    assert.match(error.message, /POST \/api\/now\/table\/sys_trigger/);
    return true;
  });
  assert.deepEqual(deleted, ['/api/now/table/sys_properties/prop-id']);
});

test('polling failure identifies the mailbox URL and cleans it up', async () => {
  const deleted = [];
  const client = {
    async post(endpoint) {
      if (endpoint.endsWith('sys_properties')) return { result: { sys_id: 'prop-id' } };
      return { result: { sys_id: 'trigger-id' } };
    },
    async get() { throw apiError(); },
    async delete(endpoint) { deleted.push(endpoint); },
  };
  const service = new ScriptService(manager(client));

  await assert.rejects(service.executeBackgroundScript('1 + 1', 2000), (error) => {
    assert.match(error.message, /mailbox polling failed/);
    assert.match(error.message, /GET \/api\/now\/table\/sys_properties\/prop-id/);
    return true;
  });
  assert.deepEqual(deleted, ['/api/now/table/sys_properties/prop-id']);
});

test('successful Scripted REST execution returns the validated result', async () => {
  const client = {
    post: async () => ({ result: { success: true, output: 'hello' } }),
  };
  const service = new ScriptService(manager(client, { scriptApiPath: '/api/x_acme/scripts/run' }));

  const result = await service.executeBackgroundScript("gs.info('hello')");
  assert.equal(result.success, true);
  assert.equal(result.output, 'hello');
  assert.equal(typeof result.executionTime, 'number');
});