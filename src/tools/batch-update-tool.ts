/**
 * MCP tool for batch updating multiple ServiceNow records
 */

import { BatchUpdateSchema } from '../schemas/batch-schemas.js';
import { BatchOutputSchema } from '../schemas/output-schemas.js';
import type { BatchService } from '../services/batch-service.js';
import type { SchemaService } from '../services/schema-service.js';
import { toolError } from '../utils/error-handler.js';
import { collectFieldNames, preflightFieldValidation } from '../utils/field-validation.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const BATCH_UPDATE_TOOL = {
	name: 'servicenow_batch_update',
	title: 'Batch update records',
	description: `What: Update many records in one table via looped Table API calls, dispatched in concurrency-limited waves (default 25 at a time, rate-limited) — not a single bulk request and NOT transactional.
When to use: To change several records at once. For a single record use servicenow_update_record.
Preconditions: Write-enabled instance (readOnly: false); valid sys_ids and field names. Default max 50 updates per call (configurable via SERVICENOW_MAX_BATCH_SIZE).
Produces: Per-record success/failure with sys_ids, plus counts. updateType "partial" (PATCH) or "full" (PUT). Not atomic: on failure, already-applied updates are NOT rolled back — inspect results[]. continueOnError=true (default) finishes the rest; false stops before the next wave.

Example:
- tableName="incident", updates=[{"sysId":"abc123...","fields":{"priority":"1"}}]`,
	inputSchema: BatchUpdateSchema,
	outputSchema: BatchOutputSchema,
};

export function createBatchUpdateTool(batchService: BatchService, schemaService?: SchemaService) {
	return {
		...BATCH_UPDATE_TOOL,
		handler: async (params: unknown) => {
			let tableName: string | undefined;
			try {
				// Validate input
				const validated = BatchUpdateSchema.parse(params);
				tableName = validated.tableName;

				logger.info(
					`Batch updating ${validated.updates.length} records in ${validated.tableName}`,
					{
						instance: validated.instance || 'default',
						updateType: validated.updateType,
						continueOnError: validated.continueOnError,
					},
				);

				// Pre-flight: validate the union of field names across the whole batch.
				// A typo'd field would otherwise be silently dropped on up to 50 records.
				const message = await preflightFieldValidation(
					schemaService,
					validated.tableName,
					collectFieldNames(validated.updates.map((u) => u.fields)),
					{ skip: validated.skipFieldValidation, instance: validated.instance },
				);
				if (message) {
					return { content: [{ type: 'text' as const, text: message }], isError: true as const };
				}

				// Perform batch update
				const result = await batchService.batchUpdate(
					validated.tableName,
					validated.updates,
					validated.updateType,
					validated.continueOnError,
					validated.instance,
				);

				// Format response for LLM
				const response = {
					success: result.success,
					message: `Batch update completed: ${result.successCount} succeeded, ${result.failureCount} failed`,
					table: validated.tableName,
					instance: validated.instance || 'default',
					updateType: validated.updateType,
					summary: {
						total: validated.updates.length,
						successCount: result.successCount,
						failureCount: result.failureCount,
						successRate: `${Math.round((result.successCount / validated.updates.length) * 100)}%`,
					},
					results: result.results,
				};

				return {
					content: [
						{
							type: 'text' as const,
							text: toolText(response),
						},
					],
					structuredContent: response,
				};
			} catch (error) {
				logger.error('Error in batch update operation', error);
				return toolError(error, { table: tableName, operation: 'update' });
			}
		},
	};
}
