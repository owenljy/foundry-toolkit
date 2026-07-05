/**
 * Table allow/deny list authorization (defense-in-depth).
 *
 * Two env knobs gate which ServiceNow tables this server may touch:
 *   - SERVICENOW_BLOCKED_TABLES — comma-separated deny-list. Always wins.
 *   - SERVICENOW_ALLOWED_TABLES — comma-separated allow-list. When non-empty,
 *     ONLY listed tables are permitted.
 *
 * Both lists are trimmed and matched case-insensitively. A single trailing '*'
 * acts as a simple prefix wildcard (e.g. "sys_user*" matches "sys_user_group").
 * If both lists are empty/unset, all tables are allowed (backward compatible).
 */

import { AccessDeniedError } from '../types/errors.js';

/**
 * Parse a comma-separated table-list env value into a normalized array.
 * Entries are trimmed, lower-cased, and empties are dropped.
 */
export function parseTableList(env?: string): string[] {
	if (!env) {
		return [];
	}

	return env
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0);
}

/**
 * Returns true if `pattern` matches `name`. Supports a single trailing-'*'
 * wildcard via startsWith; otherwise an exact (case-insensitive) match.
 * Both `name` and `pattern` are expected to be lower-cased already.
 */
function matchesPattern(name: string, pattern: string): boolean {
	if (pattern.endsWith('*')) {
		return name.startsWith(pattern.slice(0, -1));
	}

	return name === pattern;
}

/**
 * Pure check: is `name` permitted given the parsed blocked/allowed lists?
 * Rules:
 *   1. Blocked list wins — any match denies.
 *   2. If allowed list is non-empty, only matching tables are permitted.
 *   3. If both are empty, allow all.
 */
export function isTableAllowed(
	name: string,
	opts: { blocked: string[]; allowed: string[] },
): boolean {
	const normalized = name.trim().toLowerCase();

	// Rule 1: blocked list always wins.
	if (opts.blocked.some((pattern) => matchesPattern(normalized, pattern))) {
		return false;
	}

	// Rule 2: allow-list, when present, is exclusive.
	if (opts.allowed.length > 0) {
		return opts.allowed.some((pattern) => matchesPattern(normalized, pattern));
	}

	// Rule 3: no lists configured => allow all.
	return true;
}

/**
 * Assert that `name` is permitted. Reads process.env on every call (so config
 * changes and tests take effect without re-importing) and throws
 * AccessDeniedError when the table is denied.
 */
export function assertTableAllowed(name: string): void {
	const blocked = parseTableList(process.env.SERVICENOW_BLOCKED_TABLES);
	const allowed = parseTableList(process.env.SERVICENOW_ALLOWED_TABLES);

	const normalized = name.trim().toLowerCase();

	if (blocked.some((pattern) => matchesPattern(normalized, pattern))) {
		throw new AccessDeniedError(
			`Access to table "${name}" is blocked by SERVICENOW_BLOCKED_TABLES`,
			{
				table: name,
				operationType: 'table-access',
				list: 'SERVICENOW_BLOCKED_TABLES',
				suggestion: 'Remove this table from SERVICENOW_BLOCKED_TABLES to allow access.',
			},
		);
	}

	if (allowed.length > 0 && !allowed.some((pattern) => matchesPattern(normalized, pattern))) {
		throw new AccessDeniedError(
			`Table "${name}" is not in the SERVICENOW_ALLOWED_TABLES allow-list`,
			{
				table: name,
				operationType: 'table-access',
				list: 'SERVICENOW_ALLOWED_TABLES',
				suggestion: 'Add this table to SERVICENOW_ALLOWED_TABLES to allow access.',
			},
		);
	}
}
