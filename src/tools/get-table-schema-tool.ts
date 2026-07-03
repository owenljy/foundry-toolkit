/**
 * MCP tool for discovering ServiceNow table structure and field definitions
 */

import { SchemaService } from '../services/schema-service.js';
import { GetTableSchemaSchema } from '../schemas/schema-schemas.js';
import { GetTableSchemaOutputSchema } from '../schemas/output-schemas.js';
import { toolError } from '../utils/error-handler.js';
import { renderHints } from '../utils/failure-enrichment.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const GET_TABLE_SCHEMA_TOOL = {
  name: 'servicenow_get_table_schema',
  title: 'Get table schema',
  description: `What: Get a ServiceNow table's fields and their data types — every field's name, label, type, mandatory/readonly flags, max length, and (for reference fields) the name of the table it points to.
When to use: To discover what fields/columns and data types a table defines, before querying or writing. For the valid values of one choice field use servicenow_get_choice_list. To inspect a referenced table's own fields, call this tool again with that table name.
Preconditions: Table must exist; the account needs read access.
Produces: An array of field definitions (cached ~15 min in memory, up to 24h on disk).

Examples:
- tableName="incident"
- Include inherited fields from parent tables: tableName="incident", includeExtended=true`,
  inputSchema: GetTableSchemaSchema,
  outputSchema: GetTableSchemaOutputSchema,
};

export function createGetTableSchemaTool(schemaService: SchemaService) {
  return {
    ...GET_TABLE_SCHEMA_TOOL,
    handler: async (params: unknown) => {
      let tableName: string | undefined;
      try {
        // Validate input
        const validated = GetTableSchemaSchema.parse(params);
        tableName = validated.tableName;

        logger.info(`Getting schema for table: ${validated.tableName}`, {
          instance: validated.instance || 'default',
          includeExtended: validated.includeExtended,
        });

        // Get table schema
        const schema = await schemaService.getTableSchema(
          validated.tableName,
          validated.includeExtended,
          validated.instance,
        );

        // Table absent from sys_db_object (and no fields) = doesn't exist or
        // isn't readable — distinguish that from a genuinely empty schema so the
        // model doesn't treat a typo'd table name as "table has no fields".
        if (!schema.exists) {
          const hints = renderHints([
            `No schema found for '${validated.tableName}'. The table may not exist or you may lack read access — verify the name with servicenow_list_tables.`,
          ]);
          const notFound = {
            success: false,
            table: validated.tableName,
            fieldCount: 0,
            error: `Table '${validated.tableName}' not found or not readable`,
            hints,
          };
          return {
            content: [
              { type: 'text' as const, text: toolText(notFound) },
              ...(hints ? [{ type: 'text' as const, text: hints }] : []),
            ],
            structuredContent: notFound,
            isError: true as const,
          };
        }

        // Format response for LLM
        const response = {
          success: true,
          table: schema.name,
          label: schema.label,
          extends: schema.extends,
          fieldCount: schema.fields.length,
          fields: schema.fields,
          instance: validated.instance || 'default',
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
        logger.error('Error getting table schema', error);
        return toolError(error, { table: tableName });
      }
    },
  };
}
