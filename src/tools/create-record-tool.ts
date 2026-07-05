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
import { toolText } from '../utils/tool-response.js';

export const CREATE_RECORD_TOOL = {
	name: 'servicenow_create_record',
	title: 'Create record',
	description: `What: Insert a new record into a ServiceNow table.
When to use: To create data records (incident, sys_user, etc.). Do NOT use it to author app metadata (business rules, ACLs, UI policies) — that belongs in the Fluent SDK.
Preconditions: Write-enabled instance (readOnly: false); field names valid for the table (validated automatically).
Produces: The created record with its sys_id.

Examples:
- tableName="incident", fields={"short_description":"Network down","priority":"2"}
- tableName="sys_user", fields={"user_name":"john.doe","email":"john.doe@example.com"}`,
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

				// Format response for LLM
				const response = {
					success: true,
					message: `Successfully created record in ${validated.tableName}`,
					table: validated.tableName,
					sys_id: record.sys_id,
					record: record,
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
