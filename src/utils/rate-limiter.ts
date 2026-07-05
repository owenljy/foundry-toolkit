/**
 * RateLimiter — a small, dependency-free async concurrency limiter.
 *
 * Caps the number of in-flight async operations at `maxConcurrent` (queuing the
 * rest) and can optionally enforce a minimum gap between the *starts* of
 * consecutive operations (`minIntervalMs`). This bounds the load placed on a
 * ServiceNow instance so a burst of calls (or a retry loop) cannot flood it and
 * trip account/ACL lockout.
 */
export class RateLimiter {
	private readonly maxConcurrent: number;
	private readonly minIntervalMs: number;

	/** Number of operations currently running. */
	private active = 0;
	/** Timestamp (ms) of the last start, for min-interval pacing. */
	private lastStart = 0;
	/** Pending operations waiting for a slot, in FIFO order. */
	private readonly queue: Array<() => void> = [];

	constructor(maxConcurrent: number, minIntervalMs = 0) {
		// Guard against nonsensical config; always allow at least one in flight.
		this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent) || 1);
		this.minIntervalMs = Math.max(0, minIntervalMs);
	}

	/**
	 * Runs `fn` once a concurrency slot is free, respecting the min-interval
	 * pacing. Resolves/rejects with whatever `fn` produces. The slot is always
	 * released, even when `fn` throws.
	 */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			await this.pace();
			this.lastStart = Date.now();
			return await fn();
		} finally {
			this.release();
		}
	}

	/** Current number of in-flight operations (useful for tests/observability). */
	get inFlight(): number {
		return this.active;
	}

	/** Number of operations waiting for a slot. */
	get pending(): number {
		return this.queue.length;
	}

	/** Waits until a concurrency slot is available, then reserves it. */
	private acquire(): Promise<void> {
		if (this.active < this.maxConcurrent) {
			this.active += 1;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.queue.push(() => {
				this.active += 1;
				resolve();
			});
		});
	}

	/** Releases a slot and hands it to the next queued operation, if any. */
	private release(): void {
		this.active -= 1;
		const next = this.queue.shift();
		if (next) {
			next();
		}
	}

	/** Sleeps just long enough to honor `minIntervalMs` between starts. */
	private async pace(): Promise<void> {
		if (this.minIntervalMs <= 0) {
			return;
		}
		const wait = this.lastStart + this.minIntervalMs - Date.now();
		if (wait > 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, wait));
		}
	}
}
