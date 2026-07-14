/**
 * MCP tool for getting choice list values for a ServiceNow field
 */

import { GetChoiceListOutputSchema } from '../schemas/output-schemas.js';
import { GetChoiceListSchema } from '../schemas/schema-schemas.js';
import type { SchemaService } from '../services/schema-service.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolResult } from '../utils/tool-response.js';

export const GET_CHOICE_LIST_TOOL = {
	name: 'sn_get_choice_list',
	title: 'Get choice list',
	description: `What: Get the valid values for a choice (dropdown) field — label and value pairs, in display order.
When to use: Before setting a choice field, to learn its allowed values. For all of a table's fields use sn_get_table_schema.
Preconditions: Table and field must exist; read access.
Produces: An array of {label, value} choices (cached ~15 min in memory, up to 24h on disk). An empty array means the field isn't a choice field or the name is wrong — check sn_get_table_schema.`,
	inputSchema: GetChoiceListSchema,
	outputSchema: GetChoiceListOutputSchema,
};

export function createGetChoiceListTool(schemaService: SchemaService) {
	return {
		...GET_CHOICE_LIST_TOOL,
		handler: async (params: unknown) => {
			let tableName: string | undefined;
			try {
				// Validate input
				const validated = GetChoiceListSchema.parse(params);
				tableName = validated.tableName;

				logger.info(`Getting choice list for ${validated.tableName}.${validated.fieldName}`, {
					instance: validated.instance || 'default',
				});

				// Get choice list
				const choices = await schemaService.getChoiceList(
					validated.tableName,
					validated.fieldName,
					validated.instance,
				);

				// Format response for LLM
				const response: Record<string, unknown> = {
					success: true,
					table: validated.tableName,
					field: validated.fieldName,
					choiceCount: choices.length,
					choices: choices,
					instance: validated.instance || 'default',
				};

				// An empty choice list usually means a misspelled or non-choice field —
				// steer the caller to the schema rather than returning a silent []. The
				// hint lives in the structured body only (no duplicate text block).
				if (choices.length === 0) {
					response.hints = [
						`No choices for '${validated.fieldName}' on '${validated.tableName}'. It may not be a choice field, or the name is wrong — check sn_get_table_schema for the exact field name and type.`,
					];
				}

				return toolResult(
					response,
					`${choices.length} choice(s) for ${validated.tableName}.${validated.fieldName}${
						choices.length === 0 ? ' — see hints' : ''
					}`,
				);
			} catch (error) {
				logger.error('Error getting choice list', error);
				return toolError(error, { table: tableName });
			}
		},
	};
}
