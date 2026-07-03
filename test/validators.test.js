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
  const roManager = { getConfig: () => ({ name: 'prod', readOnly: true }) };
  assert.throws(() => validateWriteAccess(roManager, 'prod'), /read-only/i);

  // readOnly undefined => defaults to read-only (true)
  const defaultManager = { getConfig: () => ({ name: 'dev' }) };
  assert.throws(() => validateWriteAccess(defaultManager), /read-only/i);
});

test('validateWriteAccess permits writes when readOnly is explicitly false', () => {
  const rwManager = { getConfig: () => ({ name: 'dev', readOnly: false }) };
  assert.doesNotThrow(() => validateWriteAccess(rwManager, 'dev'));
});
