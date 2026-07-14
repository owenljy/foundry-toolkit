/**
 * MCP tool for creating ServiceNow records
 */

import { CreateRecordOutputSchema } from '../schemas/output-schemas.js';
import { CreateRecordSchema } from '../schemas/table-schemas.js';
import type { SchemaService } from '../services/schema-service.js';
import type { TableService } from '../services/table-service.js';
import { formatErrorForTool } from '../utils/error-handler.js';
import { failureHints, renderHints } from '../utils/failure-enrichment.js';
import { preflightFieldValidation } from '../utils/field-validation.js';
import { logger } from '../utils/logger.js';
import { toolResult } from '../utils/tool-response.js';

export const CREATE_RECORD_TOOL = {
	name: 'sn_create_record',
	title: 'Create record',
	description: `What: Insert a new record into a ServiceNow table.
When to use: To create data records (incident, sys_user, etc.). Do NOT use it to author app metadata (business rules, ACLs, UI policies) — that belongs in the Fluent SDK.
Preconditions: Write-enabled instance (readOnly: false); field names valid for the table (validated automatically).
Produces: sys_id plus the fields you set (not the whole freshly-created row).`,
	inputSchema: CreateRecordSchema,
	outputSchema: CreateRecordOutputSchema,
};

export function createCreateRecordTool(tableService: TableService, schemaService?: SchemaService) {
	return {
		...CREATE_RECORD_TOOL,
		handler: async (params: unknown) => {
			try {
				// Validate input
				const validated = CreateRecordSchema.parse(params);

				logger.info(`Creating record in ${validated.tableName}`, {
					fields: Object.keys(validated.fields),
				});

				// Pre-flight: catch typo'd field names that the Table API would silently drop.
				const message = await preflightFieldValidation(
					schemaService,
					validated.tableName,
					Object.keys(validated.fields),
					{ skip: validated.skipFieldValidation, instance: validated.instance },
				);
				if (message) {
					return { content: [{ type: 'text' as const, text: message }], isError: true as const };
				}

				// Create record
				const record = await tableService.createRecord(
					validated.tableName,
					validated.fields,
					validated.instance,
				);

				// Lean echo: sys_id + the fields the caller set, not the whole freshly
				// created row (dozens of system defaults the caller can re-query if
				// needed) — matches the batch services' small-echo choice.
				const sysId = typeof record.sys_id === 'string' ? record.sys_id : undefined;
				const created: Record<string, unknown> = { sys_id: record.sys_id };
				for (const k of Object.keys(validated.fields)) {
					if (k in record) created[k] = record[k];
				}
				const response = {
					success: true,
					table: validated.tableName,
					sys_id: sysId,
					record: created,
				};

				return toolResult(response, `created ${validated.tableName} ${sysId ?? ''}`.trim());
			} catch (error) {
				logger.error('Error creating record', error);

				const table = (params as { tableName?: string })?.tableName;
				const hints = renderHints(failureHints(String(error), { table, operation: 'create' }));
				return {
					content: [
						{ type: 'text' as const, text: formatErrorForTool(error) },
						...(hints ? [{ type: 'text' as const, text: hints }] : []),
					],
					isError: true as const,
				};
			}
		},
	};
}
