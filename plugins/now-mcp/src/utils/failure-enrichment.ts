/**
 * Failure enrichment (learned from ServiceNow Forge).
 *
 * Turns a bare ServiceNow error or an empty result into actionable next steps,
 * so the model can recover instead of guessing. Pure + synchronous: it
 * classifies from the error text and call context and emits hint lines — no
 * extra API calls.
 */

export interface FailureContext {
	table?: string;
	/** Free-form label of the operation for logging/future use (not branched on). */
	operation?: string;
	query?: string;
	/** ServiceNow roles required by this tool, surfaced in 403 hints. */
	requiredRoles?: string[];
}

export type FailureType = '401' | '403' | 'readonly' | '404' | '400' | 'field_error' | 'unknown';

export function classifyFailure(text: string): FailureType {
	const t = text.toLowerCase();
	if (
		t.includes('invalid field') ||
		t.includes('unknown field') ||
		t.includes('invalid column') ||
		t.includes('no such field')
	) {
		return 'field_error';
	}
	if (t.includes('401') || t.includes('authentication') || t.includes('unauthorized')) return '401';
	// A client-side read-only write block (thrown before any HTTP call). Its
	// message already carries source-aware remediation, so it needs no extra hint —
	// classify it distinctly from a genuine server ACL 403 to avoid appending
	// stale, contradictory YAML advice.
	if (t.includes('read-only') || t.includes('not permitted on read-only')) return 'readonly';
	if (t.includes('403') || t.includes('access denied') || t.includes('forbidden')) return '403';
	if (t.includes('404') || t.includes('not found') || t.includes('does not exist')) return '404';
	if (t.includes('400') || t.includes('bad request')) return '400';
	return 'unknown';
}

/**
 * Produce actionable hint lines for a failed call.
 */
export function failureHints(text: string, ctx: FailureContext = {}): string[] {
	const table = ctx.table ? `'${ctx.table}'` : 'the table';
	switch (classifyFailure(text)) {
		case 'field_error':
			return [
				`A field name appears invalid. Run sn_get_table_schema for ${table} to confirm field names`,
				'For choice fields, sn_get_choice_list shows valid values.',
			];
		case '403': {
			const roleNote = ctx.requiredRoles?.length
				? ` This tool requires the ${ctx.requiredRoles.join(' or ')} role.`
				: '';
			return [
				`Access denied on ${table}. Likely an ACL — the account may lack the required role, or the field/record is restricted.${roleNote}`,
			];
		}
		case 'readonly':
			// The read-only write-block message already includes source-aware
			// remediation (which config to edit + reload). No extra hint.
			return [];
		case '401':
			return [
				'Authentication failed. Check the instance credentials (username/password or OAuth client).',
			];
		case '404':
			return [
				`Not found. Verify the table name with sn_list_tables, and that the sys_id/record exists.`,
			];
		case '400':
			return [
				`Bad request. Check the encoded query syntax${ctx.query ? ` ("${ctx.query}")` : ''} and field values.`,
			];
		default:
			return [];
	}
}

/**
 * Hints for a successful-but-empty result set.
 */
export function zeroResultHints(ctx: FailureContext = {}): string[] {
	const hints = ['No records matched. The query may be too narrow, or the data may not exist.'];
	if (ctx.query) {
		hints.push(
			`Try broadening the query (current: "${ctx.query}") — remove a clause or use LIKE for partial matches.`,
		);
	}
	hints.push(
		'Confirm field values with sn_get_choice_list, or check the table with sn_get_table_schema.',
	);
	return hints;
}

/**
 * Render hint lines as a single text block (or null if none).
 */
export function renderHints(hints: string[]): string | null {
	if (hints.length === 0) return null;
	return `Hints:\n${hints.map((h) => `- ${h}`).join('\n')}`;
}
