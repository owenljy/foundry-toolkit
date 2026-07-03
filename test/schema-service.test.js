import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the schema disk cache at a throwaway temp dir BEFORE importing the
// service, so tests never read/write the real ~/.now-mcp cache.
const CACHE_DIR = mkdtempSync(join(tmpdir(), 'sn-schema-cache-'));
process.env.SERVICENOW_SCHEMA_CACHE_DIR = CACHE_DIR;

const { SchemaService } = await import('../build/services/schema-service.js');

after(() => {
  rmSync(CACHE_DIR, { recursive: true, force: true });
});

/**
 * Stub client that counts sys_dictionary fetches and returns canned dictionary
 * + table-object rows.
 */
function makeStubClient() {
  const state = { dictionaryCalls: 0, calls: [] };
  return {
    state,
    async get(endpoint, params) {
      state.calls.push({ endpoint, params });
      if (endpoint === '/api/now/table/sys_dictionary') {
        state.dictionaryCalls++;
        return {
          result: [
            {
              element: 'short_description',
              column_label: 'Short description',
              internal_type: 'string',
              mandatory: 'true',
              read_only: 'false',
              max_length: '160',
              reference: '',
            },
            {
              element: 'caller_id',
              column_label: 'Caller',
              internal_type: 'reference',
              mandatory: 'false',
              read_only: 'false',
              max_length: '32',
              reference: 'sys_user',
            },
          ],
        };
      }
      if (endpoint === '/api/now/table/sys_db_object') {
        return {
          result: [{ name: 'incident', label: 'Incident', 'super_class.name': 'task' }],
        };
      }
      return { result: [] };
    },
  };
}

function makeManager(client) {
  return {
    getClient: () => client,
    getConfig: () => ({ name: 'dev', readOnly: false }),
  };
}

test('getTableSchema parses sys_dictionary rows into field metadata', async () => {
  const client = makeStubClient();
  const svc = new SchemaService(makeManager(client));

  const meta = await svc.getTableSchema('incident', false, 'parsetest');

  assert.equal(meta.name, 'incident');
  assert.equal(meta.label, 'Incident');
  assert.equal(meta.extends, 'task');
  assert.equal(meta.fields.length, 2);

  const byName = Object.fromEntries(meta.fields.map((f) => [f.name, f]));
  assert.equal(byName.short_description.label, 'Short description');
  assert.equal(byName.short_description.type, 'string');
  assert.equal(byName.short_description.mandatory, true);
  assert.equal(byName.short_description.readOnly, false);
  assert.equal(byName.short_description.maxLength, 160);
  assert.equal(byName.short_description.reference, undefined);

  assert.equal(byName.caller_id.mandatory, false);
  assert.equal(byName.caller_id.reference, 'sys_user');
});

test('getTableSchema marks a nonexistent table exists:false', async () => {
  // Empty dictionary AND empty sys_db_object = table absent/unreadable.
  const emptyClient = {
    state: { calls: [] },
    async get() {
      return { result: [] };
    },
  };
  const svc = new SchemaService(makeManager(emptyClient));

  const meta = await svc.getTableSchema('nope_not_a_table', false, 'nf');
  assert.equal(meta.exists, false);
  assert.equal(meta.fields.length, 0);
});

test('getTableSchema marks a real table exists:true', async () => {
  const client = makeStubClient();
  const svc = new SchemaService(makeManager(client));
  const meta = await svc.getTableSchema('incident', false, 'existstest');
  assert.equal(meta.exists, true);
});

test('getTableSchema serves the second call from cache (client hit once)', async () => {
  const client = makeStubClient();
  const svc = new SchemaService(makeManager(client));

  await svc.getTableSchema('incident', false, 'cachetest');
  const before = client.state.dictionaryCalls;
  assert.equal(before, 1);

  await svc.getTableSchema('incident', false, 'cachetest');
  assert.equal(client.state.dictionaryCalls, 1, 'second call should be served from cache');
});

test('validateFields flags unknown fields using the parsed schema', async () => {
  const client = makeStubClient();
  const svc = new SchemaService(makeManager(client));

  const result = await svc.validateFields(
    'incident',
    ['short_description', 'made_up_field'],
    'validatetest'
  );
  assert.ok(result);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.unknown[0].field, 'made_up_field');
});
