/**
 * MCP tool for aggregating ServiceNow records via the Stats API
 */

import { TableService } from '../services/table-service.js';
import { AggregateRecordsSchema } from '../schemas/table-schemas.js';
import { AggregateRecordsOutputSchema } from '../schemas/output-schemas.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const AGGREGATE_RECORDS_TOOL = {
  name: 'servicenow_aggregate_records',
  title: 'Aggregate records',
  description: `What: Compute a count, or avg/sum/min/max, over a table via the Stats API — optionally grouped by one or more fields (group-by supports dot-walking).
When to use: For "how many", "total count", "per group", "grouped by", or numeric rollups — not when you need the actual rows (use servicenow_query_records for those).
Preconditions: Table must exist; the account needs read access.
Produces: Aggregate numbers (a single object, or an array of groups when groupBy is set).

Computes numbers server-side via the Stats API, so it is far cheaper than querying rows and reducing them client-side.

Examples:
- Count P1 incidents by assignment group:
  tableName="incident", query="priority=1", groupBy=["assignment_group"], count=true
- Average reassignment count of active incidents:
  tableName="incident", query="active=true", avgFields=["reassignment_count"]
- Open incidents per caller department (dot-walked group-by):
  tableName="incident", query="active=true", groupBy=["caller_id.department"], count=true
- Only groups with more than 5 records:
  tableName="incident", groupBy=["assignment_group"], count=true, having="count>5"

Set displayValue=true to get readable labels for group-by reference fields.`,
  inputSchema: AggregateRecordsSchema,
  outputSchema: AggregateRecordsOutputSchema,
};

export function createAggregateRecordsTool(tableService: TableService) {
  return {
    ...AGGREGATE_RECORDS_TOOL,
    handler: async (params: unknown) => {
      let tableName: string | undefined;
      try {
        const v = AggregateRecordsSchema.parse(params);
        tableName = v.tableName;

        logger.info(`Aggregating ${v.tableName}`, {
          query: v.query,
          groupBy: v.groupBy,
          count: v.count,
        });

        const startedAt = Date.now();
        const result = await tableService.aggregateRecords(
          v.tableName,
          {
            query: v.query,
            count: v.count,
            groupBy: v.groupBy,
            avgFields: v.avgFields,
            sumFields: v.sumFields,
            minFields: v.minFields,
            maxFields: v.maxFields,
            having: v.having,
            orderBy: v.orderBy,
            displayValue: v.displayValue,
          },
          v.instance,
        );
        const durationMs = Date.now() - startedAt;

        const grouped = Boolean(v.groupBy && v.groupBy.length > 0);
        const response = {
          success: true,
          table: v.tableName,
          grouped,
          result,
        };

        // rowCount is only meaningful for a grouped result (one row per group);
        // a single rollup has no row count, so omit it then.
        const meta: Record<string, unknown> = {
          instance: v.instance || 'default',
          durationMs,
        };
        if (grouped && Array.isArray(result)) {
          meta.rowCount = result.length;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: toolText(response),
            },
          ],
          structuredContent: response,
          // Result-level metadata, separate from the text body (WS-B §4.2).
          _meta: meta,
        };
      } catch (error) {
        logger.error('Error aggregating records', error);
        return toolError(error, { table: tableName, operation: 'aggregate' });
      }
    },
  };
}
