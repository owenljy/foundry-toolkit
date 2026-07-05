/**
 * Zod schemas for the consolidated table security info tool.
 */

import { z } from 'zod';
import { OpenRecord } from './output-schemas.js';

/**
 * Schema for getting consolidated security info for a table.
 */
export const GetSecurityInfoSchema = z.object({
	tableName: z
		.string()
		.min(1, 'Table name is required')
		.regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
	instance: z
		.string()
		.optional()
		.describe('ServiceNow instance name (optional, uses default instance if not specified)'),
});

export type GetSecurityInfoInput = z.infer<typeof GetSecurityInfoSchema>;

/**
 * Output schema for servicenow_get_security_info.
 *
 * Each section degrades independently: a missing permission on one query only
 * empties that section and appends a note to `warnings` — it does not fail the
 * whole call.
 */
export const GetSecurityInfoOutputSchema = z.object({
	success: z.boolean(),
	table: z.string(),
	acls: z.object({
		total: z.number(),
		byOperation: z.record(z.number()),
		tableLevel: z.number(),
		fieldLevel: z.number(),
		details: z.array(OpenRecord),
	}),
	roleRequirements: z.array(OpenRecord),
	dataPolicies: z.array(OpenRecord),
	securityBusinessRules: z.array(OpenRecord),
	warnings: z.array(z.string()).optional(),
});
