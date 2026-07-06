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

test('sanitizeQuery still blocks XSS-style content in values', () => {
  assert.throws(() => sanitizeQuery('<script>alert(1)</script>'), /dangerous/i);
  assert.throws(() => sanitizeQuery('eval(bad)'), /dangerous/i);
  // Danger lives in the VALUE, and is still caught there.
  assert.throws(
    () => sanitizeQuery('short_description=<script>onerror=alert(1)</script>'),
    /dangerous/i
  );
  assert.throws(() => sanitizeQuery('short_description=<div onmouseover=alert(1)>'), /dangerous/i);
});

test('sanitizeQuery does not false-positive on benign field names (on_plan= regression)', () => {
  // The classic false positive: `execution_plan=` contains the substring
  // `on_plan=`, which used to collide with the `on\w+=` event-handler signature.
  const q = 'execution_plan=bfc8ccfdc379c790cf16de777a01311a';
  assert.equal(sanitizeQuery(q), q);

  // Other field names whose characters brush up against XSS signatures.
  for (const good of [
    'x_on_plan=1',
    'href_count=1',
    'src_field=1',
    'onclick=1', // a field literally named onclick is still just a field name
    'execution_plan=abc^status=success',
  ]) {
    assert.equal(sanitizeQuery(good), good, `expected to allow: ${good}`);
  }
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
