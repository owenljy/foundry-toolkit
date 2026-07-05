/**
 * Per-tool-call structured logging helper (observability).
 *
 * Pure + deterministic: given a summary of a completed tool call it produces a
 * single-line message plus a structured data object suitable for
 * `logger.info(msg, data)`. No side effects, no clock reads — the caller owns
 * timing so this stays trivially testable.
 */

export interface ToolCallEntry {
	/** Tool name, e.g. 'servicenow_query_records'. */
	tool: string;
	/** Wall-clock duration of the handler in milliseconds. */
	durationMs: number;
	/** Whether the call succeeded (false when the result was an error). */
	ok: boolean;
	/** Optional target instance name. */
	instance?: string;
	/** Optional error message when the call failed. */
	error?: string;
}

export interface ToolCallLog {
	msg: string;
	data: {
		tool: string;
		durationMs: number;
		ok: boolean;
		instance?: string;
		error?: string;
	};
}

/**
 * Build a structured one-line summary of a finished tool call.
 *
 * The message is a stable, human-scannable string; the data object carries the
 * same fields in machine-readable form. Optional fields (instance, error) are
 * only included when present.
 */
export function formatToolCall(entry: ToolCallEntry): ToolCallLog {
	const status = entry.ok ? 'ok' : 'error';
	// Normalize duration to a non-negative integer for a clean log line.
	const durationMs = Math.max(0, Math.round(entry.durationMs));

	const data: ToolCallLog['data'] = {
		tool: entry.tool,
		durationMs,
		ok: entry.ok,
	};
	if (entry.instance !== undefined) {
		data.instance = entry.instance;
	}
	if (entry.error !== undefined) {
		data.error = entry.error;
	}

	let msg = `Tool call ${entry.tool} ${status} in ${durationMs}ms`;
	if (entry.instance !== undefined) {
		msg += ` [instance=${entry.instance}]`;
	}
	if (!entry.ok && entry.error !== undefined) {
		msg += `: ${entry.error}`;
	}

	return { msg, data };
}
