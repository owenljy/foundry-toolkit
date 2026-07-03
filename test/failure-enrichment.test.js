import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFailure,
  failureHints,
  zeroResultHints,
  renderHints,
} from '../build/utils/failure-enrichment.js';

test('classifyFailure recognizes the common ServiceNow failure shapes', () => {
  assert.equal(classifyFailure('Request failed with status code 403: Access denied'), '403');
  assert.equal(classifyFailure('404 not found'), '404');
  assert.equal(classifyFailure('401 Unauthorized'), '401');
  assert.equal(classifyFailure('Invalid field name: foo'), 'field_error');
  assert.equal(classifyFailure('something weird happened'), 'unknown');
});

test('403 hints mention ACLs and read-only', () => {
  const hints = failureHints('403 Access denied', { table: 'incident', operation: 'create' });
  const text = hints.join(' ');
  assert.match(text, /ACL/);
  assert.match(text, /read-only/i);
  assert.match(text, /incident/);
});

test('field_error hints point at the schema tool', () => {
  const hints = failureHints('Invalid field', { table: 'incident' });
  assert.match(hints.join(' '), /servicenow_get_table_schema/);
});

test('unknown failures produce no hints', () => {
  assert.deepEqual(failureHints('totally opaque error', {}), []);
});

test('zeroResultHints suggest broadening with the query echoed', () => {
  const hints = zeroResultHints({ table: 'incident', query: 'priority=1^state=99' });
  assert.match(hints.join(' '), /broaden/i);
  assert.match(hints.join(' '), /priority=1\^state=99/);
});

test('renderHints formats or returns null', () => {
  assert.equal(renderHints([]), null);
  assert.match(renderHints(['a', 'b']), /Hints:\n- a\n- b/);
});
