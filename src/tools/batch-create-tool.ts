/**
 * MCP tool for batch creating multiple ServiceNow records
 */

import { BatchService } from '../services/batch-service.js';
import { SchemaService } from '../services/schema-service.js';
import { BatchCreateSchema } from '../schemas/batch-schemas.js';
import { BatchOutputSchema } from '../schemas/output-schemas.js';
import { toolError } from '../utils/error-handler.js';
import { collectFieldNames, preflightFieldValidation } from '../utils/field-validation.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const BATCH_CREATE_TOOL = {
  name: 'servicenow_batch_create',
  title: 'Batch create records',
  description: `What: Create up to 50 records in one table in parallel (rate-limited).
When to use: To insert many records at once. For a single record use servicenow_create_record.
Preconditions: Write-enabled instance (readOnly: false); valid field names (validated automatically).
Produces: Per-record success/failure with sys_ids, plus success/failure counts. Set continueOnError=true to keep going past failures.

Example:
- tableName="incident", records=[{"short_description":"Issue 1"},{"short_description":"Issue 2"}]`,
  inputSchema: BatchCreateSchema,
  outputSchema: BatchOutputSchema,
};

export function createBatchCreateTool(batchService: BatchService, schemaService?: SchemaService) {
  return {
    ...BATCH_CREATE_TOOL,
    handler: async (params: unknown) => {
      let tableName: string | undefined;
      try {
        // Validate input
        const validated = BatchCreateSchema.parse(params);
        tableName = validated.tableName;

        logger.info(
          `Batch creating ${validated.records.length} records in ${validated.tableName}`,
          {
            instance: validated.instance || 'default',
            continueOnError: validated.continueOnError,
          },
        );

        // Pre-flight: validate the union of field names across the whole batch.
        // A typo'd field would otherwise be silently dropped on up to 50 records.
        const message = await preflightFieldValidation(
          schemaService,
          validated.tableName,
          collectFieldNames(validated.records),
          { skip: validated.skipFieldValidation, instance: validated.instance },
        );
        if (message) {
          return { content: [{ type: 'text' as const, text: message }], isError: true as const };
        }

        // Perform batch create
        const result = await batchService.batchCreate(
          validated.tableName,
          validated.records,
          validated.continueOnError,
          validated.instance,
        );

        // Format response for LLM
        const response = {
          success: result.success,
          message: `Batch create completed: ${result.successCount} succeeded, ${result.failureCount} failed`,
          table: validated.tableName,
          instance: validated.instance || 'default',
          summary: {
            total: validated.records.length,
            successCount: result.successCount,
            failureCount: result.failureCount,
            successRate: `${Math.round((result.successCount / validated.records.length) * 100)}%`,
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
        logger.error('Error in batch create operation', error);
        return toolError(error, { table: tableName, operation: 'create' });
      }
    },
  };
}
