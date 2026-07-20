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
		assert.equal(error.code, 'BACKGROUND_SCRIPT_ENDPOINT_UNAVAILABLE');
      assert.equal(error.statusCode, 404);
		assert.match(error.message, /Scripted REST execution transport failed/);
      assert.match(error.message, /POST \/api\/x_acme\/scripts\/run/);
		assert.match(error.message, /missing, inactive/);
		assert.match(error.message, /allowWrites does not affect it/);
		assert.match(error.message, /remove scriptApiPath/);
      return true;
    },
  );
});

test('ServiceNow requested-URI message is classified as endpoint unavailable even with HTTP 400', async () => {
  const error = new ServiceNowError('Requested URI does not represent any resource', 400, undefined, 'BAD_REQUEST');
  const client = { post: async () => { throw error; } };
  const service = new ScriptService(manager(client, { scriptApiPath: '/api/x_custom/script_runner/execute' }));

  await assert.rejects(service.executeBackgroundScript('1 + 1'), (caught) => {
    assert.equal(caught.code, 'BACKGROUND_SCRIPT_ENDPOINT_UNAVAILABLE');
    assert.equal(caught.statusCode, 400);
    assert.match(caught.message, /endpoint\/configuration failure occurred before the submitted script ran/);
    return true;
  });
});

test('transport status exposes strict scripted-rest routing and privilege model', () => {
  const service = new ScriptService(manager({}, { scriptApiPath: '/api/x_acme/scripts/run' }));
  assert.deepEqual(service.getExecutionTransportStatus(), {
    transport: 'scripted_rest',
    configuredPath: '/api/x_acme/scripts/run',
    usesCompanionEndpoint: true,
    fallbackOnFailure: false,
    privilegeModel: 'configured_endpoint_context',
    diagnostic: service.getExecutionTransportStatus().diagnostic,
  });
  assert.match(service.getExecutionTransportStatus().diagnostic, /does not elevate roles/);
});

test('transport status exposes sys_trigger when scriptApiPath is absent', () => {
  const service = new ScriptService(manager({}));
  const status = service.getExecutionTransportStatus();
  assert.equal(status.transport, 'sys_trigger');
  assert.equal(status.configuredPath, null);
  assert.equal(status.usesCompanionEndpoint, false);
  assert.match(status.diagnostic, /not an MCP role-escalation mechanism/);
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
	assert.equal(result.executionPath, 'scripted-rest');
	assert.equal(result.outcome, 'completed');
  assert.equal(typeof result.executionTime, 'number');
});

test('Scripted REST forwards runtime identity when the companion endpoint supplies it', async () => {
  const runtimeIdentity = {
    userName: 'integration.user',
    userId: 'user-id',
    roles: 'rest_api_explorer',
    isInteractive: false,
  };
  const client = {
    post: async () => ({ result: { success: true, output: 'ok', runtimeIdentity } }),
  };
  const service = new ScriptService(manager(client, { scriptApiPath: '/api/x_acme/scripts/run' }));

  const result = await service.executeBackgroundScript('1 + 1');
  assert.deepEqual(result.runtimeIdentity, runtimeIdentity);
});

test('sys_trigger wrapper captures bounded scheduler runtime identity', async () => {
  let triggerPayload;
  let polls = 0;
  const client = {
    async post(endpoint, payload) {
      if (endpoint.endsWith('sys_properties')) return { result: { sys_id: 'prop-id' } };
      triggerPayload = payload;
      return { result: { sys_id: 'trigger-id' } };
    },
    async get() {
      polls += 1;
      return {
        result: {
          value: JSON.stringify({
            status: 'done',
            success: true,
            output: 'ok',
            runtimeIdentity: {
              userName: 'system',
              userId: 'system-id',
              roles: 'admin,maint',
              isInteractive: false,
            },
          }),
        },
      };
    },
    async delete() {},
  };
  const service = new ScriptService(manager(client));

  const result = await service.executeBackgroundScript("gs.info('ok')", 2000);
  assert.equal(polls, 1);
  assert.match(triggerPayload.script, /getUserName\(\).*substring\(0, 160\)/);
  assert.match(triggerPayload.script, /getRoles\(\).*substring\(0, 800\)/);
  assert.match(triggerPayload.script, /output truncated at 2700 chars/);
  assert.deepEqual(result.runtimeIdentity, {
    userName: 'system',
    userId: 'system-id',
    roles: 'admin,maint',
    isInteractive: false,
  });
});