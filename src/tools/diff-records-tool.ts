/**
 * MCP tool for comparing two ServiceNow records field-by-field.
 */

import { DiffRecordsOutputSchema, DiffRecordsSchema } from '../schemas/diff-schemas.js';
import type { TableService } from '../services/table-service.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const DIFF_RECORDS_TOOL = {
	name: 'servicenow_diff_records',
	title: 'Diff records',
	description: `What: Compare two records on the same table field-by-field and report only the fields that differ.
When to use: To see what changed between two records (e.g. a record and its clone, or two similar incidents) without fetching both and diffing by hand.
Preconditions: Read access; both sys_ids must exist on the given table.
Produces: fieldsCompared (union of field names inspected), fieldsChanged, and diffs — a map of each changed field to its two values {a (record A), b (record B)}. Restrict the comparison with the optional fields[] argument.

Examples:
- tableName="incident", sysIdA="<32 hex>", sysIdB="<32 hex>"
- tableName="change_request", sysIdA="<32 hex>", sysIdB="<32 hex>", fields=["state","assigned_to"]`,
	inputSchema: DiffRecordsSchema,
	outputSchema: DiffRecordsOutputSchema,
};

export function createDiffRecordsTool(tableService: TableService) {
	return {
		...DIFF_RECORDS_TOOL,
		handler: async (params: unknown) => {
			let tableName: string | undefined;
			try {
				// Validate input
				const validated = DiffRecordsSchema.parse(params);
				tableName = validated.tableName;

				logger.info(
					`Diffing records ${validated.sysIdA} vs ${validated.sysIdB} on ${validated.tableName}`,
					{ instance: validated.instance || 'default' },
				);

				// Fetch both records in parallel. getRecord throws NotFoundError on a
				// missing sys_id — the catch below routes that to toolError.
				const [recordA, recordB] = await Promise.all([
					tableService.getRecord(
						validated.tableName,
						validated.sysIdA,
						validated.fields,
						validated.instance,
					),
					tableService.getRecord(
						validated.tableName,
						validated.sysIdB,
						validated.fields,
						validated.instance,
					),
				]);

				// Compare over the union of keys present on either record. JSON.stringify
				// gives a stable structural comparison for both scalar and reference
				// (object) field values.
				const keys = new Set<string>([...Object.keys(recordA), ...Object.keys(recordB)]);
				const diffs: Record<string, { a: unknown; b: unknown }> = {};
				for (const key of keys) {
					const a = (recordA as Record<string, unknown>)[key];
					const b = (recordB as Record<string, unknown>)[key];
					if (JSON.stringify(a) !== JSON.stringify(b)) {
						diffs[key] = { a, b };
					}
				}

				const response = {
					success: true,
					table: validated.tableName,
					fieldsCompared: keys.size,
					fieldsChanged: Object.keys(diffs).length,
					diffs,
				};

				return {
					content: [{ type: 'text' as const, text: toolText(response) }],
					structuredContent: response,
				};
			} catch (error) {
				logger.error('Error diffing records', error);
				return toolError(error, { table: tableName, operation: 'diff records' });
			}
		},
	};
}
