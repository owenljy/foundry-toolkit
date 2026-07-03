import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTableList,
  isTableAllowed,
  assertTableAllowed,
} from '../build/utils/table-access.js';
import { AccessDeniedError } from '../build/types/errors.js';

test('parseTableList trims, lower-cases, and drops empties', () => {
  assert.deepEqual(parseTableList('incident, Problem ,  CHANGE_request'), [
    'incident',
    'problem',
    'change_request',
  ]);
  // empty entries and stray commas are dropped
  assert.deepEqual(parseTableList('incident,, ,problem,'), ['incident', 'problem']);
  // unset / empty input => empty list
  assert.deepEqual(parseTableList(undefined), []);
  assert.deepEqual(parseTableList(''), []);
  assert.deepEqual(parseTableList('   '), []);
});

test('isTableAllowed: empty lists allow everything (backward compatible)', () => {
  assert.equal(isTableAllowed('incident', { blocked: [], allowed: [] }), true);
  assert.equal(isTableAllowed('sys_user', { blocked: [], allowed: [] }), true);
});

test('isTableAllowed: blocked list always wins', () => {
  assert.equal(
    isTableAllowed('sys_user', { blocked: ['sys_user'], allowed: [] }),
    false
  );
  // blocked wins even if also present in the allow-list
  assert.equal(
    isTableAllowed('sys_user', { blocked: ['sys_user'], allowed: ['sys_user'] }),
    false
  );
  // case-insensitive
  assert.equal(
    isTableAllowed('SYS_USER', { blocked: ['sys_user'], allowed: [] }),
    false
  );
});

test('isTableAllowed: non-empty allow-list is exclusive', () => {
  const opts = { blocked: [], allowed: ['incident', 'problem'] };
  assert.equal(isTableAllowed('incident', opts), true);
  assert.equal(isTableAllowed('problem', opts), true);
  assert.equal(isTableAllowed('change_request', opts), false);
  assert.equal(isTableAllowed('sys_user', opts), false);
});

test('isTableAllowed: trailing-* wildcard matches by prefix', () => {
  // wildcard in blocked list
  assert.equal(
    isTableAllowed('sys_user_group', { blocked: ['sys_user*'], allowed: [] }),
    false
  );
  assert.equal(
    isTableAllowed('sys_user', { blocked: ['sys_user*'], allowed: [] }),
    false
  );
  assert.equal(
    isTableAllowed('incident', { blocked: ['sys_user*'], allowed: [] }),
    true
  );
  // wildcard in allow-list
  const allowOpts = { blocked: [], allowed: ['sys_user*'] };
  assert.equal(isTableAllowed('sys_user_group', allowOpts), true);
  assert.equal(isTableAllowed('incident', allowOpts), false);
});

test('assertTableAllowed throws AccessDeniedError when blocked', () => {
  const savedBlocked = process.env.SERVICENOW_BLOCKED_TABLES;
  const savedAllowed = process.env.SERVICENOW_ALLOWED_TABLES;
  try {
    process.env.SERVICENOW_BLOCKED_TABLES = 'sys_user,sys_audit';
    delete process.env.SERVICENOW_ALLOWED_TABLES;

    assert.throws(
      () => assertTableAllowed('sys_user'),
      (err) =>
        err instanceof AccessDeniedError &&
        /blocked by SERVICENOW_BLOCKED_TABLES/.test(err.message)
    );
    // a non-blocked table is fine when no allow-list is set
    assert.doesNotThrow(() => assertTableAllowed('incident'));
  } finally {
    restoreEnv('SERVICENOW_BLOCKED_TABLES', savedBlocked);
    restoreEnv('SERVICENOW_ALLOWED_TABLES', savedAllowed);
  }
});

test('assertTableAllowed throws when not in non-empty allow-list', () => {
  const savedBlocked = process.env.SERVICENOW_BLOCKED_TABLES;
  const savedAllowed = process.env.SERVICENOW_ALLOWED_TABLES;
  try {
    delete process.env.SERVICENOW_BLOCKED_TABLES;
    process.env.SERVICENOW_ALLOWED_TABLES = 'incident,problem';

    assert.throws(
      () => assertTableAllowed('sys_user'),
      (err) =>
        err instanceof AccessDeniedError &&
        /not in the SERVICENOW_ALLOWED_TABLES allow-list/.test(err.message)
    );
    // a table in the allow-list passes
    assert.doesNotThrow(() => assertTableAllowed('incident'));
  } finally {
    restoreEnv('SERVICENOW_BLOCKED_TABLES', savedBlocked);
    restoreEnv('SERVICENOW_ALLOWED_TABLES', savedAllowed);
  }
});

test('assertTableAllowed allows everything when no lists are set', () => {
  const savedBlocked = process.env.SERVICENOW_BLOCKED_TABLES;
  const savedAllowed = process.env.SERVICENOW_ALLOWED_TABLES;
  try {
    delete process.env.SERVICENOW_BLOCKED_TABLES;
    delete process.env.SERVICENOW_ALLOWED_TABLES;
    assert.doesNotThrow(() => assertTableAllowed('any_table'));
    assert.doesNotThrow(() => assertTableAllowed('sys_user'));
  } finally {
    restoreEnv('SERVICENOW_BLOCKED_TABLES', savedBlocked);
    restoreEnv('SERVICENOW_ALLOWED_TABLES', savedAllowed);
  }
});

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
