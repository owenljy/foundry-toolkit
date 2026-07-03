import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../build/utils/rate-limiter.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('never exceeds maxConcurrent under a burst', async () => {
  const limiter = new RateLimiter(3);
  let active = 0;
  let maxObserved = 0;

  const task = async () => {
    active += 1;
    maxObserved = Math.max(maxObserved, active);
    await sleep(10);
    active -= 1;
    return active;
  };

  // Fire 20 at once; only 3 should ever run concurrently.
  await Promise.all(Array.from({ length: 20 }, () => limiter.run(task)));

  assert.equal(maxObserved, 3);
  assert.equal(limiter.inFlight, 0);
  assert.equal(limiter.pending, 0);
});

test('runs all queued tasks and returns their results', async () => {
  const limiter = new RateLimiter(2);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => limiter.run(async () => i * 2))
  );
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10]);
});

test('a rejecting task releases its slot (does not deadlock)', async () => {
  const limiter = new RateLimiter(1);

  await assert.rejects(
    limiter.run(async () => {
      throw new Error('boom');
    }),
    /boom/
  );

  // The slot must be free again for subsequent work.
  const ok = await limiter.run(async () => 'recovered');
  assert.equal(ok, 'recovered');
  assert.equal(limiter.inFlight, 0);
});

test('minIntervalMs paces the starts of consecutive tasks', async () => {
  const gap = 40;
  const limiter = new RateLimiter(1, gap);
  const starts = [];

  await Promise.all(
    Array.from({ length: 3 }, () =>
      limiter.run(async () => {
        starts.push(Date.now());
      })
    )
  );

  assert.equal(starts.length, 3);
  // Allow a little scheduler slop below the configured gap.
  assert.ok(starts[1] - starts[0] >= gap - 5, `gap0 was ${starts[1] - starts[0]}`);
  assert.ok(starts[2] - starts[1] >= gap - 5, `gap1 was ${starts[2] - starts[1]}`);
});

test('invalid maxConcurrent still allows at least one in flight', async () => {
  const limiter = new RateLimiter(0);
  const out = await limiter.run(async () => 'ran');
  assert.equal(out, 'ran');
});
