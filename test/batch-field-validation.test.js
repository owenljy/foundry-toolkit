import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectFieldNames,
  preflightFieldValidation,
} from '../build/utils/field-validation.js';

test('collectFieldNames returns the de-duplicated union across records', () => {
  const records = [
    { short_description: 'a', priority: '1' },
    { short_description: 'b', urgency: '2' },
    { assigned_to: 'x' },
  ];
  const union = collectFieldNames(records).sort();
  assert.deepEqual(union, ['assigned_to', 'priority', 'short_description', 'urgency']);
});

test('collectFieldNames handles an empty batch', () => {
  assert.deepEqual(collectFieldNames([]), []);
});

// A fake validator standing in for SchemaService.validateFields. Records the
// field names it was asked to check, so we can assert the union was passed.
function fakeValidator(knownFields) {
  const calls = [];
  return {
    calls,
    async validateFields(tableName, fieldNames) {
      calls.push({ tableName, fieldNames });
      const known = new Set(knownFields);
      return { unknown: fieldNames.filter((f) => !known.has(f.split('.')[0])).map((f) => ({ field: f })) };
    },
  };
}

test('preflightFieldValidation returns null when no validator is provided', async () => {
  const msg = await preflightFieldValidation(undefined, 'incident', ['bogus_field']);
  assert.equal(msg, null);
});

test('preflightFieldValidation returns null when skip is true (validator untouched)', async () => {
  const validator = fakeValidator(['short_description']);
  const msg = await preflightFieldValidation(validator, 'incident', ['bogus_field'], {
    skip: true,
  });
  assert.equal(msg, null);
  assert.equal(validator.calls.length, 0);
});

test('preflightFieldValidation returns null when all fields are known', async () => {
  const validator = fakeValidator(['short_description', 'priority']);
  const msg = await preflightFieldValidation(validator, 'incident', [
    'short_description',
    'priority',
  ]);
  assert.equal(msg, null);
  assert.equal(validator.calls.length, 1);
});

test('preflightFieldValidation returns a formatted error for unknown fields', async () => {
  const validator = fakeValidator(['short_description']);
  const msg = await preflightFieldValidation(validator, 'incident', [
    'short_description',
    'made_up_field',
  ]);
  assert.ok(msg, 'expected an error message');
  assert.match(msg, /made_up_field/);
  assert.match(msg, /silently drop/);
  assert.match(msg, /skipFieldValidation/);
});

test('preflightFieldValidation returns null when the schema is unavailable (validator returns null)', async () => {
  const validator = {
    async validateFields() {
      return null; // e.g. no read access to sys_dictionary
    },
  };
  const msg = await preflightFieldValidation(validator, 'incident', ['anything']);
  assert.equal(msg, null);
});

test('batch union + preflight: a typo in one of many records is caught once', async () => {
  // Mirrors what the batch tools do: collect the union, then validate it once.
  const records = [
    { short_description: 'a', priority: '1' },
    { short_description: 'b', priorty: '2' }, // typo only in the 2nd record
  ];
  const validator = fakeValidator(['short_description', 'priority']);
  const union = collectFieldNames(records);
  const msg = await preflightFieldValidation(validator, 'incident', union);
  assert.ok(msg);
  assert.match(msg, /priorty/);
  // Validated as a single batched call, not once per record.
  assert.equal(validator.calls.length, 1);
});
