/**
 * Output schemas for MCP tools (structured output).
 *
 * Each tool advertises an `outputSchema` and returns `structuredContent` that
 * conforms to it. Per the design (D2), records are modeled OPEN
 * (`z.record(z.unknown())`) and envelopes are NOT `.strict()` — extra keys must
 * pass (Zod object default strips unknown keys, it does not fail). The
 * top-level value is always a JSON object.
 *
 * These schemas are intentionally permissive: they describe the *shape* the
 * agent can rely on, not an exhaustive contract. Align each to what the
 * matching handler actually returns.
 */

import { z } from 'zod';

/** An arbitrary ServiceNow record / nested object: open by design. */
export const OpenRecord = z.record(z.unknown());

/**
 * servicenow_query_records
 *
 * `records` is the array actually returned to the caller, which may be a
 * truncated view of what the query matched (render guardrail — see the tool).
 * When truncation kicks in, `truncated` is true and `returnedRows` /
 * `fetchedRows` describe the cut so the caller can narrow the query.
 */
export const QueryRecordsOutputSchema = z.object({
  success: z.boolean(),
  table: z.string(),
  // Rows returned in this page (after the render cap).
  count: z.number(),
  records: z.array(OpenRecord),
  // Render guardrail: true when `records` was capped below the fetched result.
  truncated: z.boolean().optional(),
  // Rows actually included in `records` after the render cap.
  returnedRows: z.number().optional(),
  // Rows fetched in this page before the render cap was applied.
  fetchedRows: z.number().optional(),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
    // Total rows matching the query across all pages (from X-Total-Count);
    // omitted when the instance did not return the header.
    totalMatching: z.number().optional(),
  }),
  hints: z.unknown().optional(),
});

/** servicenow_aggregate_records */
export const AggregateRecordsOutputSchema = z.object({
  success: z.boolean(),
  table: z.string(),
  grouped: z.boolean(),
  result: z.unknown(),
});

/** servicenow_create_record */
export const CreateRecordOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  table: z.string(),
  sys_id: z.string().optional(),
  record: OpenRecord,
});

/** servicenow_update_record */
export const UpdateRecordOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  table: z.string(),
  sys_id: z.string().optional(),
  updateType: z.string().optional(),
  record: OpenRecord,
});

/** servicenow_delete_record */
export const DeleteRecordOutputSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  tableName: z.string(),
  sysId: z.string(),
  instance: z.string(),
  warning: z.string().optional(),
});

/** Shared batch result envelope (create + update). */
export const BatchOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  table: z.string(),
  instance: z.string(),
  updateType: z.string().optional(),
  summary: z.object({
    total: z.number(),
    successCount: z.number(),
    failureCount: z.number(),
    successRate: z.string(),
  }),
  results: z.array(OpenRecord),
});

// ServiceNow reference fields can arrive as a plain string or as a
// {value, display_value, link} object depending on instance/version.
function normalizeSNRef(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val || undefined;
  if (typeof val === 'object' && val !== null) {
    const o = val as { display_value?: unknown; value?: unknown };
    const s = o.display_value || o.value;
    return typeof s === 'string' ? s || undefined : undefined;
  }
  return undefined;
}

/** servicenow_get_table_schema */
export const GetTableSchemaOutputSchema = z.object({
  success: z.boolean(),
  table: z.string(),
  label: z.string().optional(),
  extends: z.preprocess(normalizeSNRef, z.string().optional()),
  fieldCount: z.number(),
  fields: z.array(OpenRecord),
  instance: z.string(),
});

/** servicenow_list_tables */
export const ListTablesOutputSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  filter: z.string().optional(),
  instance: z.string(),
  tables: z.array(OpenRecord),
});

/** servicenow_get_choice_list */
export const GetChoiceListOutputSchema = z.object({
  success: z.boolean(),
  table: z.string(),
  field: z.string(),
  choiceCount: z.number(),
  choices: z.array(OpenRecord),
  instance: z.string(),
});

/** servicenow_execute_background_script */
export const ExecuteScriptOutputSchema = z.object({
  success: z.boolean(),
  executionTime: z.number().optional(),
  output: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  instance: z.string(),
  schemaCheck: z.array(OpenRecord).optional(),
  // Present when allowWrites:true and writes were detected — echoes the approved
  // write calls (and a warning if any hit metadata/config tables).
  writeApproved: z
    .object({
      calls: z.array(z.string()),
      metadataWarning: z.string().optional(),
    })
    .optional(),
  warning: z.string().optional(),
});

/** servicenow_upload_attachment */
export const UploadAttachmentOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  attachment: OpenRecord,
});

/** servicenow_download_attachment */
export const DownloadAttachmentOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  attachment: OpenRecord,
});

/** servicenow_sdk_status */
export const SdkStatusOutputSchema = z.object({
  success: z.boolean(),
  nowSdkVersion: z.string().nullable().optional(),
  // Version parsed to its components (null when now-sdk is absent/unparseable).
  nowSdkSemver: z
    .object({ major: z.number(), minor: z.number(), patch: z.number() })
    .nullable()
    .optional(),
  // Capability → available? resolved against the detected version, so callers
  // stop assuming now-sdk can do something the installed CLI can't.
  features: z.record(z.boolean()).optional(),
  // Constraint each feature flag was resolved from (e.g. query: ">=4.8.0").
  featureConstraints: z.record(z.string()).optional(),
  // False when the detected version is one whose `auth --list` text format the
  // parser has NOT been verified against (newer major / unknown version).
  authListFormatVerified: z.boolean().optional(),
  profiles: z.array(OpenRecord),
  alignment: z.array(OpenRecord),
  nowSdkDefaultProfile: z.string().nullable().optional(),
  nowSdkDefaultHost: z.string().nullable().optional(),
  mcpDefaultInstance: z.string().nullable().optional(),
  defaultAligned: z.boolean(),
  recommendedDefaultInstance: z.string().nullable().optional(),
  defaultNote: z.string(),
  note: z.string(),
});
