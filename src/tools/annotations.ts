/**
 * MCP tool annotations (behavioral hints) keyed by tool name.
 *
 * These are standard MCP `annotations` that let a client reason about a tool's
 * safety before calling it:
 *   - readOnlyHint:   does not modify the instance
 *   - destructiveHint: may remove/overwrite data (only meaningful when not read-only)
 *   - idempotentHint: repeating the call with the same args has no extra effect
 *   - openWorldHint:  interacts with an external system outside this server's
 *                     control (here: a live ServiceNow instance)
 */

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

// Every instance-facing tool talks to a live external ServiceNow instance, so
// openWorldHint is true for RO/WRITE/DESTRUCTIVE. sdk_status is the exception
// (SDK_STATUS below) — it reports local now-sdk CLI state, not the instance.
const RO: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
// idempotentHint:true here is deliberate: re-deleting an already-gone record (or
// re-running cleanup by token) is a no-op. Clients may use this hint to allow
// automatic retry, which is safe for these operations.
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};
// servicenow_sdk_status inspects the LOCAL now-sdk CLI, not the ServiceNow
// instance, so openWorldHint is false.
const SDK_STATUS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // Reads
  servicenow_query_records: RO,
  servicenow_aggregate_records: RO,
  servicenow_get_table_schema: RO,
  servicenow_list_tables: RO,
  servicenow_get_choice_list: RO,
  servicenow_download_attachment: RO,
  servicenow_sdk_status: SDK_STATUS,

  // Writes (create new state)
  servicenow_create_record: WRITE,
  servicenow_update_record: WRITE,
  servicenow_batch_create: WRITE,
  servicenow_batch_update: WRITE,
  servicenow_upload_attachment: WRITE,

  // Destructive / arbitrary code
  servicenow_delete_record: DESTRUCTIVE,
  servicenow_execute_background_script: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};
