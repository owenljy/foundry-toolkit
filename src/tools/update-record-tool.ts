/**
 * MCP tool for updating ServiceNow records
 */

import { TableService } from '../services/table-service.js';
import { SchemaService } from '../services/schema-service.js';
import { UpdateRecordSchema } from '../schemas/table-schemas.js';
import { UpdateRecordOutputSchema } from '../schemas/output-schemas.js';
import { formatErrorForTool } from '../utils/error-handler.js';
import { preflightFieldValidation } from '../utils/field-validation.js';
import { failureHints, renderHints } from '../utils/failure-enrichment.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const UPDATE_RECORD_TOOL = {
  name: 'servicenow_update_record',
  title: 'Update record',
  description: `What: Modify an existing record (PATCH partial or PUT full) by sys_id.
When to use: To change field values on a known record. For app metadata, use the Fluent SDK instead.
Preconditions: Write-enabled instance (readOnly: false); valid sys_id; field names valid for the table (validated automatically).
Produces: The updated record with its current field values.

updateType: "partial" (default) PATCHes only the provided fields; "full" PUTs a full replacement.

Examples:
- tableName="incident", sysId="abc123...", fields={"state":"2"}, updateType="partial"
- tableName="sys_user", sysId="xyz789...", fields={"email":"new.email@example.com"}`,
  inputSchema: UpdateRecordSchema,
  outputSchema: UpdateRecordOutputSchema,
};

export function createUpdateRecordTool(tableService: TableService, schemaService?: SchemaService) {
  return {
    ...UPDATE_RECORD_TOOL,
    handler: async (params: unknown) => {
      try {
        // Validate input
        const validated = UpdateRecordSchema.parse(params);

        logger.info(`Updating record ${validated.sysId} in ${validated.tableName}`, {
          fields: Object.keys(validated.fields),
          updateType: validated.updateType,
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

        // Update record
        const record = await tableService.updateRecord(
          validated.tableName,
          validated.sysId,
          validated.fields,
          validated.updateType === 'full',
          validated.instance,
        );

        // Format response for LLM
        const response = {
          success: true,
          message: `Successfully updated record ${validated.sysId} in ${validated.tableName}`,
          table: validated.tableName,
          sys_id: record.sys_id,
          updateType: validated.updateType,
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
        logger.error('Error updating record', error);

        const table = (params as { tableName?: string })?.tableName;
        const hints = renderHints(failureHints(String(error), { table, operation: 'update' }));
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
