import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../build/utils/circuit-breaker.js';

/** Builds a breaker with a controllable clock. */
function makeBreaker(overrides = {}) {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    authFailureThreshold: 2,
    cooldownMs: 30000,
    now: () => clock,
    ...overrides,
  });
  return {
    breaker,
    advance: (ms) => {
      clock += ms;
    },
    set: (ms) => {
      clock = ms;
    },
  };
}

test('starts closed and allows requests', () => {
  const { breaker } = makeBreaker();
  assert.equal(breaker.state(), 'closed');
  assert.equal(breaker.canRequest(), true);
});

test('opens after the generic failure threshold and blocks', () => {
  const { breaker } = makeBreaker({ failureThreshold: 3, authFailureThreshold: 99 });

  breaker.recordFailure('other');
  breaker.recordFailure('other');
  assert.equal(breaker.state(), 'closed');
  assert.equal(breaker.canRequest(), true);

  breaker.recordFailure('other'); // crosses threshold
  assert.equal(breaker.state(), 'open');
  assert.equal(breaker.canRequest(), false);
});

test('auth failures open the breaker faster than generic failures', () => {
  // Same low auth threshold; generic threshold high.
  const { breaker } = makeBreaker({ failureThreshold: 10, authFailureThreshold: 2 });

  breaker.recordFailure('auth');
  assert.equal(breaker.state(), 'closed');
  breaker.recordFailure('auth'); // crosses auth threshold at 2
  assert.equal(breaker.state(), 'open');

  // Compare: a generic-only breaker with the same counts stays closed.
  const other = makeBreaker({ failureThreshold: 10, authFailureThreshold: 2 }).breaker;
  other.recordFailure('other');
  other.recordFailure('other');
  assert.equal(other.state(), 'closed');
});

test('half-opens after cooldown and closes on a successful trial', () => {
  const { breaker, advance } = makeBreaker({ failureThreshold: 2, cooldownMs: 30000 });

  breaker.recordFailure('other');
  breaker.recordFailure('other');
  assert.equal(breaker.state(), 'open');

  // Before cooldown elapses: still blocked.
  advance(29999);
  assert.equal(breaker.canRequest(), false);
  assert.equal(breaker.state(), 'open');

  // After cooldown: one trial allowed -> half-open.
  advance(1);
  assert.equal(breaker.canRequest(), true);
  assert.equal(breaker.state(), 'half-open');

  // Only ONE trial: a second concurrent request is blocked.
  assert.equal(breaker.canRequest(), false);

  // Successful trial closes and resets.
  breaker.recordSuccess();
  assert.equal(breaker.state(), 'closed');
  assert.equal(breaker.canRequest(), true);
});

test('a failed half-open trial re-opens and restarts the cooldown', () => {
  const { breaker, advance } = makeBreaker({ failureThreshold: 2, cooldownMs: 30000 });

  breaker.recordFailure('other');
  breaker.recordFailure('other');
  assert.equal(breaker.state(), 'open');

  advance(30000);
  assert.equal(breaker.canRequest(), true); // half-open trial
  assert.equal(breaker.state(), 'half-open');

  breaker.recordFailure('other'); // trial fails
  assert.equal(breaker.state(), 'open');

  // Cooldown restarts: blocked again until another full window passes.
  assert.equal(breaker.canRequest(), false);
  advance(29999);
  assert.equal(breaker.canRequest(), false);
  advance(1);
  assert.equal(breaker.canRequest(), true);
});

test('a success in the closed state resets accumulated failures', () => {
  const { breaker } = makeBreaker({ failureThreshold: 3, authFailureThreshold: 99 });

  breaker.recordFailure('other');
  breaker.recordFailure('other');
  breaker.recordSuccess(); // resets counters
  breaker.recordFailure('other');
  breaker.recordFailure('other');
  assert.equal(breaker.state(), 'closed'); // would have opened at 3 without the reset
});
