/**
 * CircuitBreaker — stops hammering an instance that keeps failing.
 *
 * After enough consecutive failures the breaker "opens" and short-circuits
 * further requests for a cooldown window, instead of letting a retry loop keep
 * hitting ServiceNow (which can trip account lockout). Authentication failures
 * (401) are counted separately and trip the breaker faster than
 * generic failures, since a bad-credential loop is the fastest path to lockout.
 *
 * States:
 *   - 'closed'    : normal operation; requests allowed, failures counted.
 *   - 'open'      : requests blocked until `cooldownMs` has elapsed.
 *   - 'half-open' : after cooldown, ONE trial request is allowed:
 *                     success -> 'closed' (counters reset)
 *                     failure -> 'open'   (cooldown restarts)
 */

export type FailureKind = 'authentication' | 'transient' | 'auth' | 'other';
export type BreakerState = 'closed' | 'open' | 'half-open';
export type BreakerOpenReason = 'repeated_authentication_failures' | 'repeated_transient_failures';

export interface CircuitBreakerSnapshot {
	state: BreakerState;
	failureScore: number;
	authFailureScore: number;
	openedReason?: BreakerOpenReason;
	lastFailureAt?: number;
	retryAfterMs: number;
}

export interface CircuitBreakerOptions {
	/** Consecutive generic failures that open the breaker. */
	failureThreshold: number;
	/** Consecutive authentication (401) failures that open the breaker (usually lower). */
	authFailureThreshold: number;
	/** How long the breaker stays open before allowing a half-open trial (ms). */
	cooldownMs: number;
	/** Injectable clock; defaults to Date.now (makes timing deterministic in tests). */
	now?: () => number;
}

export class CircuitBreaker {
	private readonly failureThreshold: number;
	private readonly authFailureThreshold: number;
	private readonly cooldownMs: number;
	private readonly now: () => number;

	private currentState: BreakerState = 'closed';
	/** Weighted failure count toward `failureThreshold`. */
	private failureScore = 0;
	/** Count of consecutive auth failures toward `authFailureThreshold`. */
	private authFailureScore = 0;
	/** Timestamp (ms) when the breaker last opened. */
	private openedAt = 0;
	private openedReason?: BreakerOpenReason;
	private lastFailureAt?: number;
	/** True once a half-open trial has been handed out (only one is permitted). */
	private trialInFlight = false;

	constructor(opts: CircuitBreakerOptions) {
		this.failureThreshold = Math.max(1, Math.floor(opts.failureThreshold) || 1);
		this.authFailureThreshold = Math.max(1, Math.floor(opts.authFailureThreshold) || 1);
		this.cooldownMs = Math.max(0, opts.cooldownMs);
		this.now = opts.now ?? Date.now;
	}

	/**
	 * Whether a request may proceed right now. Has the side effect of
	 * transitioning open -> half-open once the cooldown has elapsed, and of
	 * reserving the single half-open trial.
	 */
	canRequest(): boolean {
		if (this.currentState === 'closed') {
			return true;
		}

		if (this.currentState === 'open') {
			if (this.now() - this.openedAt >= this.cooldownMs) {
				// Cooldown elapsed: allow exactly one trial request.
				this.currentState = 'half-open';
				this.trialInFlight = true;
				return true;
			}
			return false;
		}

		// half-open: only the single in-flight trial is permitted; block others.
		if (!this.trialInFlight) {
			this.trialInFlight = true;
			return true;
		}
		return false;
	}

	/** Records a successful call: closes the breaker and clears all counters. */
	recordSuccess(): void {
		this.currentState = 'closed';
		this.failureScore = 0;
		this.authFailureScore = 0;
		this.trialInFlight = false;
		this.openedReason = undefined;
		this.lastFailureAt = undefined;
	}

	/**
	 * Records a failed call. A failure during a half-open trial re-opens the
	 * breaker immediately. Otherwise the relevant counter is incremented and the
	 * breaker opens once a threshold is crossed.
	 */
	recordFailure(kind: FailureKind): void {
		const normalized = kind === 'auth' ? 'authentication' : kind === 'other' ? 'transient' : kind;
		this.lastFailureAt = this.now();
		if (this.currentState === 'half-open') {
			// The trial failed — back off again for a full cooldown.
			this.open(
				normalized === 'authentication'
					? 'repeated_authentication_failures'
					: 'repeated_transient_failures',
			);
			return;
		}

		if (normalized === 'authentication') {
			this.authFailureScore += 1;
		} else {
			this.failureScore += 1;
		}

		if (
			this.authFailureScore >= this.authFailureThreshold ||
			this.failureScore >= this.failureThreshold
		) {
			this.open(
				this.authFailureScore >= this.authFailureThreshold
					? 'repeated_authentication_failures'
					: 'repeated_transient_failures',
			);
		}
	}

	/** Current breaker state as a string. */
	state(): BreakerState {
		return this.currentState;
	}

	/** Observable, secret-free state for diagnostics and structured errors. */
	snapshot(): CircuitBreakerSnapshot {
		const retryAfterMs =
			this.currentState === 'open'
				? Math.max(0, this.cooldownMs - (this.now() - this.openedAt))
				: 0;
		return {
			state: this.currentState,
			failureScore: this.failureScore,
			authFailureScore: this.authFailureScore,
			openedReason: this.openedReason,
			lastFailureAt: this.lastFailureAt,
			retryAfterMs,
		};
	}

	/** Explicitly closes the breaker after credentials/configuration are repaired. */
	reset(): void {
		this.recordSuccess();
		this.openedAt = 0;
	}

	/** Transitions to open and (re)starts the cooldown clock. */
	private open(reason: BreakerOpenReason): void {
		this.currentState = 'open';
		this.openedAt = this.now();
		this.openedReason = reason;
		this.trialInFlight = false;
	}
}
