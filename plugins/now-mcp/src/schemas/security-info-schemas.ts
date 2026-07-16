/**
 * Zod schemas for the consolidated table security info tool.
 */

import { z } from 'zod';
import { instanceField, tableNameField } from './common.js';
import { OpenRecord } from './output-schemas.js';

/**
 * Schema for getting consolidated security info for a table.
 */
export const GetSecurityInfoSchema = z.object({
	tableName: tableNameField(),
	instance: instanceField,
	includeDetails: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			'false (default): return only summarized counts and roles grouped by operation — much smaller. true: also include the raw per-ACL detail array and per-ACL role list.',
		),
	operations: z
		.array(z.enum(['create', 'read', 'write', 'update', 'delete']))
		.optional()
		.describe('Optional ACL operations to retain, e.g. ["update","delete"].'),
	fields: z
		.array(z.string().regex(/^[a-zA-Z0-9_]+$/))
		.max(50)
		.optional()
		.describe('Optional field names; retain table ACLs plus ACLs for these fields.'),
});

export type GetSecurityInfoInput = z.infer<typeof GetSecurityInfoSchema>;

/**
 * Output schema for sn_get_security_info.
 *
 * Each section degrades independently: a missing permission on one query only
 * empties that section and appends a note to `warnings` — it does not fail the
 * whole call. `details`/`roleRequirements` are only populated when the caller
 * passes `includeDetails: true`; the summary fields (`byOperation`,
 * `rolesByOperation`) are always present and are cheap since they're derived
 * from records already fetched for the counts.
 */
export const GetSecurityInfoOutputSchema = z.object({
	success: z.boolean(),
	table: z.string(),
	acls: z.object({
		total: z.number(),
		byOperation: z.record(z.number()),
		tableLevel: z.number(),
		fieldLevel: z.number(),
		details: z.array(OpenRecord).optional(),
	}),
	rolesByOperation: z.record(z.array(z.string())),
	roleRequirements: z.array(OpenRecord).optional(),
	dataPolicies: z.array(OpenRecord),
	securityBusinessRules: z.array(OpenRecord),
	beforeBusinessRules: z.array(OpenRecord).optional(),
	dictionary: z.array(OpenRecord).optional(),
	warnings: z.array(z.string()).optional(),
});
