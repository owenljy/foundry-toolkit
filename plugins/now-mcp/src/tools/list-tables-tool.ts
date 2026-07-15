/**
 * MCP tool for listing available ServiceNow tables
 */

import { ListTablesOutputSchema } from '../schemas/output-schemas.js';
import { ListTablesSchema } from '../schemas/schema-schemas.js';
import type { SchemaService } from '../services/schema-service.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolResult } from '../utils/tool-response.js';

export const LIST_TABLES_TOOL = {
	name: 'sn_list_tables',
	title: 'List tables',
	description: `What: List tables in the instance, with optional name filtering.
When to use: To discover which table to use. For a single table's fields use sn_get_table_schema.
Preconditions: Read access to the dictionary.
Produces: An array of tables (name, label, parent table); cached ~15 min in memory, up to 24h on disk.

Filter matching: trailing * = starts-with (incident*), leading * = ends-with (*task), both/neither = substring (*task*, task).

Examples:
- All tables (first 100): no parameters
- Starts with: filter="incident*"
- Substring, capped: filter="*task*", limit=50`,
	inputSchema: ListTablesSchema,
	outputSchema: ListTablesOutputSchema,
};

export function createListTablesTool(schemaService: SchemaService) {
	return {
		...LIST_TABLES_TOOL,
		handler: async (params: unknown) => {
			try {
				// Validate input
				const validated = ListTablesSchema.parse(params);
				const target = schemaService.resolveInstance(validated.instance);

				logger.info('Listing tables', {
					instance: target.name,
					instanceUrl: target.url,
					filter: validated.filter,
					limit: validated.limit,
				});

				// List tables
				const tables = await schemaService.listTables(
					validated.filter,
					validated.limit,
					target.name,
				);

				const response = {
					success: true,
					count: tables.length,
					filter: validated.filter,
					instance: target.name,
					instanceUrl: target.url,
					tables: tables,
				};

				return toolResult(
					response,
					`${tables.length} table(s)${validated.filter ? ` matching "${validated.filter}"` : ''}`,
				);
			} catch (error) {
				logger.error('Error listing tables', error);
				return toolError(error, { operation: 'list tables' });
			}
		},
	};
}
