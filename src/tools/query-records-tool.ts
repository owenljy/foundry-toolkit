/**
 * MCP tool for querying ServiceNow records
 */

import { TableService } from '../services/table-service.js';
import { QueryRecordsSchema } from '../schemas/table-schemas.js';
import { QueryRecordsOutputSchema } from '../schemas/output-schemas.js';
import { toolError } from '../utils/error-handler.js';
import { zeroResultHints } from '../utils/failure-enrichment.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

/**
 * Render guardrail — independent of the requested `limit` (which the schema caps
 * at 10000). A single response that dumps thousands of rows floods the caller's
 * context, so we cap the rows *actually returned* to the client and also cap the
 * serialized JSON size. Whichever cap bites first truncates `records`; the
 * truncation is signaled explicitly (structuredContent.truncated + _meta) and in
 * a human note so the caller can narrow the query instead of silently losing rows.
 */
const MAX_RETURNED_ROWS = 1000;
/** ~1 MB of serialized JSON before we start dropping trailing rows. */
const MAX_SERIALIZED_BYTES = 1_000_000;

/**
 * Cap `records` by row count and serialized size. Returns the (possibly
 * shortened) array plus whether truncation happened. Pure — no side effects.
 */
function capRenderedRows(records: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  truncated: boolean;
} {
  // Row-count cap first (cheap), then size cap on the survivors.
  let rows = records.length > MAX_RETURNED_ROWS ? records.slice(0, MAX_RETURNED_ROWS) : records;
  let truncated = rows.length < records.length;

  if (Buffer.byteLength(JSON.stringify(rows)) > MAX_SERIALIZED_BYTES) {
    // Binary search for the largest prefix that fits the byte budget.
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (Buffer.byteLength(JSON.stringify(rows.slice(0, mid))) <= MAX_SERIALIZED_BYTES) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    rows = rows.slice(0, lo);
    truncated = true;
  }

  return { rows, truncated };
}

export const QUERY_RECORDS_TOOL = {
  name: 'servicenow_query_records',
  title: 'Query records',
  description: `What: List/fetch/read the actual record rows from a ServiceNow table, with filters, field selection, dot-walking, and pagination.
When to use: To retrieve the rows themselves — show me / fetch / find matching records. For counts, group-by, or avg/sum/min/max use servicenow_aggregate_records instead.
Preconditions: Table must exist; the account needs read access to it.
Produces: An array of the matching records (plus pagination metadata, and recovery hints when empty).

Pass a ServiceNow encoded query in the query parameter.

Prefer passing the fields parameter — wide tables return 100+ columns per row
otherwise, which floods context and truncates the result.

Examples:
- Filter + fields: tableName="incident", query="priority=1^state=2", fields=["number","short_description","priority"]
- Unassigned + critical: tableName="incident", query="assigned_toISEMPTY^priority=1", fields=["number","short_description"]
- Pagination: tableName="incident", limit=50, offset=100 (response.pagination.hasMore / totalMatching guide the next page)

Encoded operators: = != ^ (AND) ^OR > < >= <= LIKE STARTSWITH ENDSWITH IN ISEMPTY ISNOTEMPTY.
Dot-walking: traverse reference fields with dots in both query and fields, e.g.
query="caller_id.department.name=Network", fields=["caller_id.department.manager.email"].
Set displayValue=true for human-readable labels of reference/choice fields, or "all" for both.`,
  inputSchema: QueryRecordsSchema,
  outputSchema: QueryRecordsOutputSchema,
};

export function createQueryRecordsTool(tableService: TableService) {
  return {
    ...QUERY_RECORDS_TOOL,
    handler: async (params: unknown) => {
      let tableName: string | undefined;
      try {
        // Validate input
        const validated = QueryRecordsSchema.parse(params);
        tableName = validated.tableName;

        logger.info(`Querying ${validated.tableName}`, {
          query: validated.query,
          limit: validated.limit,
          offset: validated.offset,
        });

        // Query records
        const startedAt = Date.now();
        const { records, totalCount } = await tableService.queryRecordsWithMeta(
          validated.tableName,
          {
            query: validated.query,
            limit: validated.limit,
            offset: validated.offset,
            fields: validated.fields,
            displayValue: validated.displayValue,
            excludeReferenceLink: validated.excludeReferenceLink,
          },
          validated.instance,
        );
        const durationMs = Date.now() - startedAt;

        // fetchedCount = rows in this page; totalMatching = rows matching the
        // query across all pages (from X-Total-Count, null if not reported).
        const fetchedCount = records.length;
        const totalMatching = totalCount;

        // Render guardrail: cap the rows that actually reach the caller,
        // independent of the requested `limit`, so a huge result can't flood the
        // client context. `renderedRows` is what we serialize.
        const { rows: renderedRows, truncated } = capRenderedRows(records);

        // hasMore: prefer the exact answer from the total count (are there rows
        // beyond this page's offset+size?); fall back to the page-size heuristic
        // when the instance didn't return X-Total-Count.
        const hasMore =
          totalMatching !== null
            ? validated.offset + fetchedCount < totalMatching
            : fetchedCount === validated.limit;

        // Format response for LLM
        const response: Record<string, unknown> = {
          success: true,
          table: validated.tableName,
          count: fetchedCount, // rows returned in this page
          records: renderedRows,
          pagination: {
            limit: validated.limit,
            offset: validated.offset,
            hasMore,
            ...(totalMatching !== null ? { totalMatching } : {}),
          },
        };

        // Signal truncation explicitly so the caller can narrow the query
        // instead of silently losing rows.
        if (truncated) {
          response.truncated = true;
          response.returnedRows = renderedRows.length;
          response.fetchedRows = fetchedCount;
        }

        // Enrich an empty result set with recovery hints.
        if (records.length === 0) {
          response.hints = zeroResultHints({
            table: validated.tableName,
            query: validated.query,
          });
        }

        // Compact + char-capped serialization (from main) layered on top of the
        // row/byte render guardrail above — both keep tool-result context small.
        const content = [
          {
            type: 'text' as const,
            text: toolText(response),
          },
        ];
        if (truncated) {
          content.push({
            type: 'text' as const,
            text:
              `Note: the result was truncated — showing ${renderedRows.length} of ${fetchedCount} fetched rows ` +
              `(render cap ${MAX_RETURNED_ROWS} rows / ${MAX_SERIALIZED_BYTES} bytes). ` +
              `Narrow the query to see the rest: add filters, select fewer fields, or use servicenow_aggregate_records for counts/group-by.`,
          });
        }

        return {
          content,
          structuredContent: response,
          // Result-level metadata, separate from the text body (WS-B §4.2).
          _meta: {
            instance: validated.instance || 'default',
            durationMs,
            // Rows actually returned to the caller after the render cap.
            rowCount: renderedRows.length,
            // Rows fetched in this page before the cap; equals rowCount when not truncated.
            fetchedCount,
            // Rows matching the query across all pages (null if X-Total-Count absent).
            totalMatching,
            truncated,
          },
        };
      } catch (error) {
        logger.error('Error querying records', error);
        return toolError(error, { table: tableName, query: undefined, operation: 'query' });
      }
    },
  };
}
