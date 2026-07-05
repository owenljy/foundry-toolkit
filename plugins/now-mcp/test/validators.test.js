import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeQuery, validateSysId, validateWriteAccess } from '../build/utils/validators.js';

test('sanitizeQuery allows ServiceNow glide expressions (javascript:gs.*)', () => {
  const q = 'opened_atONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()';
  assert.equal(sanitizeQuery(q), q);
  assert.equal(
    sanitizeQuery('assigned_to=javascript:gs.getUserID()^priority=1'),
    'assigned_to=javascript:gs.getUserID()^priority=1'
  );
});

test('sanitizeQuery still blocks XSS-style content', () => {
  assert.throws(() => sanitizeQuery('<script>alert(1)</script>'), /dangerous/i);
  assert.throws(() => sanitizeQuery('x=1^onclick=evil'), /dangerous/i);
  assert.throws(() => sanitizeQuery('eval(bad)'), /dangerous/i);
});

test('validateSysId accepts 32-char hex, rejects others', () => {
  assert.doesNotThrow(() => validateSysId('a'.repeat(32)));
  assert.throws(() => validateSysId('tooshort'));
  assert.throws(() => validateSysId('z'.repeat(32))); // non-hex
});

test('validateWriteAccess throws for read-only instances', () => {
  const roManager = {
    getConfig: () => ({ name: 'prod', readOnly: true }),
    getConfigSource: () => ({ kind: 'env' }),
  };
  assert.throws(() => validateWriteAccess(roManager, 'prod'), /read-only/i);

  // readOnly undefined => defaults to read-only (true)
  const defaultManager = {
    getConfig: () => ({ name: 'dev' }),
    getConfigSource: () => ({ kind: 'env' }),
  };
  assert.throws(() => validateWriteAccess(defaultManager), /read-only/i);
});

test('validateWriteAccess read-only message is source-aware (plugin form vs YAML)', () => {
  const envManager = {
    getConfig: () => ({ name: 'prod', readOnly: true }),
    getConfigSource: () => ({ kind: 'env' }),
  };
  assert.throws(() => validateWriteAccess(envManager, 'prod'), /plugin form|SERVICENOW_READ_ONLY/);

  const yamlManager = {
    getConfig: () => ({ name: 'prod', readOnly: true }),
    getConfigSource: () => ({ kind: 'yaml', path: '/tmp/sn.yaml' }),
  };
  assert.throws(() => validateWriteAccess(yamlManager, 'prod'), /\/tmp\/sn\.yaml/);
});

test('validateWriteAccess permits writes when readOnly is explicitly false', () => {
  const rwManager = {
    getConfig: () => ({ name: 'dev', readOnly: false }),
    getConfigSource: () => ({ kind: 'env' }),
  };
  assert.doesNotThrow(() => validateWriteAccess(rwManager, 'dev'));
});
