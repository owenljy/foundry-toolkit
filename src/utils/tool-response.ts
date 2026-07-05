/**
 * Serialization helper for MCP tool-result text.
 *
 * Tool results persist in the model's context for the whole session, so their
 * token cost is paid on every subsequent turn. This helper keeps that cost low:
 *   - Compact JSON (no pretty-print indentation, which is pure token overhead
 *     for an LLM consumer).
 *   - A hard character cap so a runaway query or background-script dump can't
 *     balloon the context; when tripped, the result is truncated with a hint to
 *     narrow the request.
 */

const MAX_TOOL_TEXT = 16000;

export function toolText(value: unknown): string {
	const s = JSON.stringify(value);
	return s.length <= MAX_TOOL_TEXT
		? s
		: s.slice(0, MAX_TOOL_TEXT) +
				`\n…[truncated ${s.length - MAX_TOOL_TEXT} chars — narrow fields/limit or use servicenow_aggregate_records]`;
}
