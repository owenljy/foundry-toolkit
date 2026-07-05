/**
 * Zod schemas for the diff-records tool (compare two records field-by-field).
 */

import { z } from 'zod';

/**
 * Schema for comparing two records on the same table.
 *
 * sysIdA / sysIdB mirror the attachment-schemas sys_id validation (exactly 32
 * hexadecimal characters).
 */
export const DiffRecordsSchema = z.object({
	tableName: z
		.string()
		.min(1, 'Table name is required')
		.regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
	sysIdA: z
		.string()
		.length(32, 'sysIdA must be exactly 32 characters')
		.regex(/^[a-f0-9]{32}$/i, 'sysIdA must be a valid hexadecimal string'),
	sysIdB: z
		.string()
		.length(32, 'sysIdB must be exactly 32 characters')
		.regex(/^[a-f0-9]{32}$/i, 'sysIdB must be a valid hexadecimal string'),
	fields: z
		.array(z.string())
		.optional()
		.describe('Optional subset of fields to compare (defaults to all fields on both records)'),
	instance: z
		.string()
		.optional()
		.describe('ServiceNow instance name (optional, uses default instance if not specified)'),
});

export type DiffRecordsInput = z.infer<typeof DiffRecordsSchema>;

/**
 * Output schema for servicenow_diff_records.
 *
 * `diffs` maps each changed field name to the two differing values (a from
 * record A, b from record B). Values are open (`z.unknown()`) because a
 * ServiceNow field value may be a string or a reference object.
 */
export const DiffRecordsOutputSchema = z.object({
	success: z.boolean(),
	table: z.string(),
	fieldsCompared: z.number(),
	fieldsChanged: z.number(),
	diffs: z.record(
		z.object({
			a: z.unknown(),
			b: z.unknown(),
		}),
	),
});
