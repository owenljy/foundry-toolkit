/**
 * MCP tool for executing arbitrary background scripts in ServiceNow
 */

import { ScriptService } from '../services/script-service.js';
import { SchemaService } from '../services/schema-service.js';
import { ExecuteBackgroundScriptSchema } from '../schemas/script-schemas.js';
import { ExecuteScriptOutputSchema } from '../schemas/output-schemas.js';
import { toolError } from '../utils/error-handler.js';
import { extractTableFieldRefs, detectWriteOperations } from '../utils/script-analysis.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const EXECUTE_BACKGROUND_SCRIPT_TOOL = {
  name: 'servicenow_execute_background_script',
  title: 'Execute background script',
  description: `What: Run server-side JavaScript in ServiceNow via a temporary sys_trigger, then return its logged output.
When to use: For logic the Table/Stats APIs can't express. Prefer servicenow_query_records / servicenow_aggregate_records for plain reads.
Preconditions: A WRITE-ENABLED instance (readOnly: false). The tool creates a temporary sys_trigger to run the script — that trigger is itself a write, so it will NOT run on a read-only instance, even for a read-only script. Also needs an admin/elevated role — the script runs with full system privileges. Configurable timeout (default 60s, max 2m).

WARNING: executes arbitrary code with full privileges; all executions are logged.

Write policy (governs writes INSIDE the script body — separate from the instance needing to be write-enabled above):
- The script body is treated as READ-ONLY by default. Any detected insert()/update()/delete() call is BLOCKED unless allowWrites: true is explicitly set.
- allowWrites: true is the approval signal — only set it when the user has confirmed the writes are intentional.
- Writes to metadata/config tables (sys_business_rule, sys_script_include, etc.) are flagged separately even when allowWrites: true — those belong in Fluent source control, not ad-hoc scripts.
- Detection is heuristic (literal GlideRecord table names only); dynamic table references are not caught. When a write's table can't be resolved statically, the result carries a lowConfidenceWarning — the metadata-table check is incomplete, so review the script manually.

Runtime contract (runs in ServiceNow's Rhino engine, NOT Node):
- Output capture: call log('...') to return output. gs.log()/gs.info() calls in your script are automatically rewritten to log() — both work. Return values are discarded.
- No import/require/module system; synchronous only (no setTimeout/Promise/await).
- Use GlideRecordSecure + canWrite() for writes; setLimit() your queries.
- Referenced table/field names are checked against the live schema first; unknown names come back in a "schemaCheck" field (advisory — the script still runs).

Example (read-only script body — allowWrites not needed; instance must still be write-enabled):
  var gr = new GlideRecord('incident');
  gr.addQuery('active', true);
  gr.setLimit(5);
  gr.query();
  while (gr.next()) { log('INC: ' + gr.number); }`,
  inputSchema: ExecuteBackgroundScriptSchema,
  outputSchema: ExecuteScriptOutputSchema,
};

export function createExecuteBackgroundScriptTool(
  scriptService: ScriptService,
  schemaService?: SchemaService,
) {
  return {
    ...EXECUTE_BACKGROUND_SCRIPT_TOOL,
    handler: async (params: unknown) => {
      try {
        // Validate input
        const validated = ExecuteBackgroundScriptSchema.parse(params);

        logger.info('Executing background script', {
          scriptLength: validated.script.length,
          timeout: validated.timeout,
          instance: validated.instance || 'default',
        });

        // Write-operation gate: block unless allowWrites is explicitly set.
        const writeDetection = detectWriteOperations(validated.script);
        if (writeDetection.hasWrites && !validated.allowWrites) {
          const calls = writeDetection.writeCalls.map((c) =>
            c.table ? `${c.method} on '${c.table}'` : c.method,
          );
          const blocked = {
            blocked: true,
            reason: 'Script contains write operations and allowWrites is not set.',
            detected: calls,
            ...(writeDetection.metadataTables.length > 0
              ? {
                  metadataWarning: `Writes to metadata/config tables detected: ${writeDetection.metadataTables.join(', ')}. These belong in Fluent source control, not ad-hoc scripts.`,
                }
              : {}),
            ...(writeDetection.lowConfidence
              ? {
                  lowConfidenceWarning: `${writeDetection.unresolvedWrites} write(s) target a GlideRecord whose table name could not be resolved (dynamic name, concatenation, or function return). The metadata-table check is incomplete for those — a write to a protected table may be unflagged. Review the script manually before approving.`,
                }
              : {}),
            hint: 'Set allowWrites: true to explicitly approve this script. Only do so after confirming the writes are intentional.',
          };
          return {
            content: [{ type: 'text' as const, text: toolText(blocked) }],
            isError: true as const,
          };
        }

        // Advisory pre-flight: validate any table/field names the script
        // references against the live schema. ADVISORY ONLY — heuristic static
        // analysis must never block a valid script, so we attach findings and
        // still execute. Grounds the model's NEXT script with real field names.
        const schemaCheck = schemaService
          ? await runSchemaPreflight(schemaService, validated.script, validated.instance)
          : undefined;

        // Execute background script
        const result = await scriptService.executeBackgroundScript(
          validated.script,
          validated.timeout,
          validated.instance,
        );

        // Format response for LLM
        const response = {
          success: result.success,
          executionTime: result.executionTime,
          output: result.output ?? null,
          error: result.error ?? null,
          instance: validated.instance || 'default',
          ...(schemaCheck ? { schemaCheck } : {}),
          ...(writeDetection.hasWrites && validated.allowWrites
            ? {
                writeApproved: {
                  calls: writeDetection.writeCalls.map((c) =>
                    c.table ? `${c.method} on '${c.table}'` : c.method,
                  ),
                  ...(writeDetection.metadataTables.length > 0
                    ? {
                        metadataWarning: `Wrote to metadata/config tables: ${writeDetection.metadataTables.join(', ')}. Consider moving this to Fluent source control.`,
                      }
                    : {}),
                  ...(writeDetection.lowConfidence
                    ? {
                        lowConfidenceWarning: `${writeDetection.unresolvedWrites} approved write(s) target a GlideRecord whose table name could not be resolved statically — the metadata-table check could not cover them. Verify none wrote to a protected metadata/config table.`,
                      }
                    : {}),
                },
              }
            : {}),
          warning: result.success
            ? undefined
            : 'Script execution failed. Check error details above.',
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
        logger.error('Error executing background script', error);
        return toolError(error, { operation: 'execute background script' });
      }
    },
  };
}

interface SchemaPreflightFinding {
  table: string;
  unknownFields?: { field: string; suggestion?: string }[];
  note?: string;
}

/**
 * Validate the table/field names a script references against the live schema.
 * ADVISORY — returns findings to attach to the result; never throws or blocks.
 */
async function runSchemaPreflight(
  schemaService: SchemaService,
  script: string,
  instance?: string,
): Promise<SchemaPreflightFinding[] | undefined> {
  try {
    const refs = extractTableFieldRefs(script);
    if (refs.length === 0) return undefined;

    const findings: SchemaPreflightFinding[] = [];
    for (const { table, fields } of refs) {
      const result = await schemaService.validateFields(table, fields, instance);
      if (result === null) {
        // Couldn't resolve the table's schema — typo'd table name or no read
        // access. A close real-table suggestion disambiguates the two.
        const suggestion = await schemaService.suggestTableName(table, instance);
        findings.push({
          table,
          note: suggestion
            ? `Table '${table}' not resolved — did you mean '${suggestion}'? (or no read access)`
            : 'Schema not resolved (unknown table or no read access) — field names not checked.',
        });
      } else if (result.unknown.length > 0) {
        findings.push({ table, unknownFields: result.unknown });
      }
    }
    return findings.length > 0 ? findings : undefined;
  } catch (error) {
    // Pre-flight is best-effort; never let it interfere with execution.
    logger.debug('Script schema pre-flight skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
