import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, closestMatch } from '../build/utils/levenshtein.js';
import { validateFieldNames, formatFieldValidationError } from '../build/utils/field-validation.js';

test('levenshtein computes edit distance', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('closestMatch suggests near matches and ignores far ones', () => {
  const fields = ['assigned_to', 'short_description', 'priority', 'state'];
  assert.equal(closestMatch('assigned_too', fields), 'assigned_to');
  assert.equal(closestMatch('priorty', fields), 'priority'); // 1-edit typo
  assert.equal(closestMatch('xyzzy', fields), undefined); // nothing close
  assert.equal(closestMatch('state', fields), undefined); // exact match => no suggestion
});

test('closestMatch ignores exact matches — load-bearing for SchemaService.suggestTableName', () => {
  // suggestTableName() relies on this to tell "typo'd table" (suggest it) apart
  // from "table exists but no read access" (exact match -> undefined -> no
  // suggestion). If the distance>0 guard is ever dropped, that breaks silently.
  const tables = ['incident', 'problem', 'change_request', 'sys_user'];
  assert.equal(closestMatch('incident', tables), undefined); // exact -> no self-suggestion
  assert.equal(closestMatch('incidnet', tables), 'incident'); // typo -> suggested
});

test('validateFieldNames flags unknown fields with suggestions', () => {
  const known = ['short_description', 'assigned_to', 'priority', 'caller_id'];
  const result = validateFieldNames(
    ['short_description', 'assigned_too', 'made_up_field'],
    known
  );
  assert.equal(result.unknown.length, 2);
  const byField = Object.fromEntries(result.unknown.map((u) => [u.field, u.suggestion]));
  assert.equal(byField['assigned_too'], 'assigned_to');
  assert.equal(byField['made_up_field'], undefined);
});

test('validateFieldNames validates dot-walked fields on their root only', () => {
  const known = ['caller_id', 'short_description'];
  const result = validateFieldNames(['caller_id.department.name'], known);
  assert.equal(result.unknown.length, 0);
});

test('formatFieldValidationError produces actionable text or null', () => {
  assert.equal(formatFieldValidationError('incident', { unknown: [] }), null);
  const msg = formatFieldValidationError('incident', {
    unknown: [{ field: 'assigned_too', suggestion: 'assigned_to' }],
  });
  assert.match(msg, /Did you mean "assigned_to"/);
  assert.match(msg, /skipFieldValidation/);
});
