import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchService } from '../build/services/batch-service.js';

const MAX_CONCURRENT = 25; // mirrors DEFAULT_BATCH_CONCURRENCY in config/batch-config.ts

/**
 * Stub client whose post/patch/put track concurrent in-flight calls so we can
 * assert the service never exceeds the concurrency cap. `failOn` is a predicate
 * on the body that, when true, makes the call reject.
 */
function makeConcurrencyClient({ failOn } = {}) {
  const state = { inFlight: 0, maxInFlight: 0, total: 0 };
  const run = async (body) => {
    state.inFlight++;
    state.total++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    // Yield so concurrent calls actually overlap.
    await new Promise((r) => setTimeout(r, 5));
    state.inFlight--;
    if (failOn && failOn(body)) {
      throw new Error('simulated failure');
    }
    return { result: { sys_id: 'a'.repeat(32) } };
  };
  return {
    state,
    async post(_endpoint, body) {
      return run(body);
    },
    async patch(_endpoint, body) {
      return run(body);
    },
    async put(_endpoint, body) {
      return run(body);
    },
    async get() {
      return { result: [] };
    },
    async delete() {
      return {};
    },
  };
}

function makeManager(client, config = {}) {
  return {
    getClient: () => client,
    getConfig: () => ({ name: 'dev', readOnly: false, ...config }),
    getConfigSource: () => ({ kind: 'env' }),
  };
}

test('batchCreate respects the max-concurrency cap', async () => {
  const client = makeConcurrencyClient();
  const svc = new BatchService(makeManager(client));

  // 60 records => more than one batch of MAX_CONCURRENT.
  const records = Array.from({ length: 60 }, (_, i) => ({ short_description: `r${i}` }));
  const result = await svc.batchCreate('incident', records, true);

  assert.equal(result.success, true);
  assert.equal(result.successCount, 60);
  assert.equal(result.failureCount, 0);
  assert.equal(client.state.total, 60);
  assert.ok(
    client.state.maxInFlight <= MAX_CONCURRENT,
    `maxInFlight ${client.state.maxInFlight} should not exceed ${MAX_CONCURRENT}`
  );
});

test('batchCreate continueOnError: one failure does not abort the rest', async () => {
  const client = makeConcurrencyClient({ failOn: (body) => body.short_description === 'r2' });
  const svc = new BatchService(makeManager(client));

  const records = Array.from({ length: 5 }, (_, i) => ({ short_description: `r${i}` }));
  const result = await svc.batchCreate('incident', records, true);

  assert.equal(result.success, false);
  assert.equal(result.successCount, 4);
  assert.equal(result.failureCount, 1);
  // Per-record reporting: index 2 failed, the others succeeded.
  assert.equal(result.results[2].success, false);
  assert.match(result.results[2].error, /simulated failure/);
  assert.equal(result.results[0].success, true);
  assert.equal(result.results[4].success, true);
});

test('batchCreate continueOnError=false stops before the next batch', async () => {
  // 60 records = 3 batches of 25/25/10. Fail one record in the FIRST batch.
  // The first batch is already dispatched and completes, but the service must
  // NOT schedule batches 2 and 3 — so total dispatched stays at 25, not 60.
  const client = makeConcurrencyClient({ failOn: (body) => body.short_description === 'r3' });
  const svc = new BatchService(makeManager(client));

  const records = Array.from({ length: 60 }, (_, i) => ({ short_description: `r${i}` }));
  const result = await svc.batchCreate('incident', records, false);

  assert.equal(client.state.total, MAX_CONCURRENT, 'should not dispatch beyond the first batch');
  assert.equal(result.success, false);
  assert.equal(result.failureCount, 1);
  assert.equal(result.successCount, MAX_CONCURRENT - 1);
  // results array stays dense (no sparse holes) and schema-conformant.
  assert.equal(result.results.length, MAX_CONCURRENT);
  assert.ok(result.results.every((r) => r !== undefined));
});

test('batchCreate continueOnError=false still reports the failure per-record', async () => {
  // Within a batch, all records are dispatched concurrently and awaited via
  // Promise.allSettled, so a single failure surfaces in the per-record results
  // rather than rejecting the whole batch.
  const client = makeConcurrencyClient({ failOn: (body) => body.short_description === 'r1' });
  const svc = new BatchService(makeManager(client));

  const records = Array.from({ length: 5 }, (_, i) => ({ short_description: `r${i}` }));
  const result = await svc.batchCreate('incident', records, false);

  assert.equal(result.success, false);
  assert.equal(result.failureCount, 1);
  assert.equal(result.results[1].success, false);
  assert.match(result.results[1].error, /simulated failure/);
});

test('batchUpdate continueOnError reports per-record success/failure', async () => {
  const sysId = (n) => String(n).repeat(32).slice(0, 32);
  const client = makeConcurrencyClient({ failOn: (body) => body.state === 'bad' });
  const svc = new BatchService(makeManager(client));

  const updates = [
    { sysId: 'a'.repeat(32), fields: { state: '2' } },
    { sysId: 'b'.repeat(32), fields: { state: 'bad' } },
    { sysId: 'c'.repeat(32), fields: { state: '3' } },
  ];
  const result = await svc.batchUpdate('incident', updates, 'partial', true);

  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 1);
  assert.equal(result.results[1].success, false);
  assert.equal(result.results[1].sysId, 'b'.repeat(32));
  assert.equal(result.results[0].success, true);
  void sysId;
});

test('batch operations are blocked on read-only instances', async () => {
  const client = makeConcurrencyClient();
  const svc = new BatchService(makeManager(client, { readOnly: true }));

  await assert.rejects(
    () => svc.batchCreate('incident', [{ short_description: 'x' }], true),
    /read-only/i
  );
  await assert.rejects(
    () => svc.batchUpdate('incident', [{ sysId: 'a'.repeat(32), fields: { x: 1 } }], 'partial', true),
    /read-only/i
  );
  assert.equal(client.state.total, 0);
});
