/**
 * MCP tool for deleting a ServiceNow record
 */

import { DeleteRecordOutputSchema } from '../schemas/output-schemas.js';
import { DeleteRecordSchema } from '../schemas/table-schemas.js';
import type { TableService } from '../services/table-service.js';
import { formatErrorForTool } from '../utils/error-handler.js';
import { failureHints, renderHints } from '../utils/failure-enrichment.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const DELETE_RECORD_TOOL = {
	name: 'servicenow_delete_record',
	title: 'Delete record',
	description: `What: Permanently delete a record by sys_id (destructive).
When to use: To remove a specific record.
Preconditions: Write-enabled instance (readOnly: false); valid sys_id.
Produces: A deletion confirmation.

WARNING: permanent hard delete. There is no trash/undo — recovery is only possible via a rollback context on audited tables or a database backup, so do not assume it's reversible. Verify the sys_id first; consider deactivating (active=false) instead of deleting. This deletes a DATA record — app config/metadata is managed via the Fluent SDK. Business rules or missing permissions may block the delete.`,
	inputSchema: DeleteRecordSchema,
	outputSchema: DeleteRecordOutputSchema,
};

export function createDeleteRecordTool(tableService: TableService) {
	return {
		...DELETE_RECORD_TOOL,
		handler: async (params: unknown) => {
			try {
				// Validate input
				const validated = DeleteRecordSchema.parse(params);

				logger.info(`Deleting record from ${validated.tableName}`, {
					sysId: validated.sysId,
					instance: validated.instance || 'default',
				});

				// Delete record
				const result = await tableService.deleteRecord(
					validated.tableName,
					validated.sysId,
					validated.instance,
				);

				// Format response for LLM
				const response = {
					success: result.success,
					message: result.message,
					tableName: validated.tableName,
					sysId: validated.sysId,
					instance: validated.instance || 'default',
					warning: 'Record has been permanently deleted',
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
				logger.error('Error deleting record', error);

				const table = (params as { tableName?: string })?.tableName;
				const hints = renderHints(failureHints(String(error), { table, operation: 'delete' }));
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
