# now-mcp Improvement Plan: Gaps Found via fde-mcp Comparison

**Author context:** Comparative review of `now-mcp` against `fde-mcp` (23-27 "building block" tools + diagnostics suite) and `servicenow-mcp` (forge). Recommendations below are filtered to match now-mcp's own stated design principle (`src/tools/index.ts` header comment): *"senses, not hands" — this server is the live-instance observation + data layer; authoring app metadata is the job of the Fluent SDK, not blind table POSTs from here.* Anything that would let a tool write structural metadata directly (bypassing Fluent) was deliberately excluded even where fde-mcp has an equivalent.

---

## 1. `switch_default_instance` tool — wire up existing capability

### Current state
`InstanceManager.setDefaultInstance(instanceName: string): void` already exists and is fully implemented (`src/client/instance-manager.ts:137`):
```ts
setDefaultInstance(instanceName: string): void {
  if (!this.clients.has(instanceName)) {
    const available = Array.from(this.clients.keys()).join(', ');
    throw new ServiceNowError(`Instance '${instanceName}' not found. Available instances: ${available}`, 400);
  }
  this.defaultInstance = instanceName;
}
```
Grep across all 14 files in `src/tools/` and `src/tools/index.ts` (the registration list) confirms **no tool calls this method**. The only way to change which instance a call without an explicit `instance` argument hits is to edit `config/servicenow-instances.yaml` and restart the process, or pass `instance` on every single call.

### Reference implementation (fde-mcp)
`src/tools/building-blocks/switchInstance.ts` (`fde_switch_instance`):
- Input: `instance` (name from `~/.claude/servicenow-instances.json`, or `_env_` to revert to env-based config)
- Calls `InstanceManager.switchInstance(instanceName)`, returns early with `isError: true` if the name isn't a known profile
- **Immediately verifies connectivity** with a cheap read (`sys_properties` where `name=instance_name`) and reports the resolved instance name in the response, or a clear warning if the probe failed — so a bad switch is never silent

### Proposed now-mcp implementation
New file `src/tools/switch-default-instance-tool.ts`, following the existing `createXTool(service)` factory pattern used by every other tool:

```ts
// src/schemas/instance-schemas.ts (add)
export const SwitchDefaultInstanceSchema = z.object({
  instance: z.string().describe("Name of a configured instance to make default for this session"),
});
export const SwitchDefaultInstanceOutputSchema = z.object({
  success: z.boolean(),
  previousDefault: z.string(),
  newDefault: z.string(),
  connectivityVerified: z.boolean(),
  connectivityDetail: z.string().optional(),
});
```

```ts
// src/tools/switch-default-instance-tool.ts
export const SWITCH_DEFAULT_INSTANCE_TOOL = {
  name: 'servicenow_switch_default_instance',
  title: 'Switch default instance',
  description: `What: Change which configured instance receives tool calls that omit the "instance" argument.
When to use: Working across multiple instances in one session and want subsequent calls to default to a different one, without passing instance= every time.
Preconditions: The target must already be a configured instance (see servicenow://instances resource).
Produces: Confirmation of the switch plus a connectivity probe against the new default.

Example:
- instance="dev2"`,
  inputSchema: SwitchDefaultInstanceSchema,
  outputSchema: SwitchDefaultInstanceOutputSchema,
};

export function createSwitchDefaultInstanceTool(instanceManager: InstanceManager, tableService: TableService) {
  return {
    ...SWITCH_DEFAULT_INSTANCE_TOOL,
    handler: async (params: unknown) => {
      try {
        const { instance } = SwitchDefaultInstanceSchema.parse(params);
        const previousDefault = instanceManager.getDefaultInstance();

        instanceManager.setDefaultInstance(instance); // throws ServiceNowError if unknown — caught by toolError below

        // Cheap connectivity probe, mirroring fde_switch_instance's pattern.
        let connectivityVerified = false;
        let connectivityDetail: string | undefined;
        try {
          const rows = await tableService.queryRecords('sys_properties', {
            query: 'name=instance_name',
            fields: ['value'],
            limit: 1,
          }, instance);
          connectivityVerified = true;
          connectivityDetail = rows[0]?.value ? `Connected. Instance name: ${rows[0].value}` : 'Connected.';
        } catch (err) {
          connectivityDetail = `WARNING: connectivity probe failed: ${err instanceof Error ? err.message : String(err)}`;
        }

        const response = { success: true, previousDefault, newDefault: instance, connectivityVerified, connectivityDetail };
        return { content: [{ type: 'text' as const, text: toolText(response) }], structuredContent: response };
      } catch (error) {
        return toolError(error, { operation: 'switch default instance' });
      }
    },
  };
}
```

Register in `src/tools/index.ts`'s `tools` array (instance-management section, alongside `createListTablesTool` etc.):
```ts
createSwitchDefaultInstanceTool(instanceManager, tableService),
```

**Note:** unlike fde-mcp's `_env_` revert option, now-mcp's `InstanceManager` is YAML-config-driven with an explicit `default: true` flag per instance (not env-var-based) — the revert path here is simply switching back to whichever instance has `default: true` in the YAML, which the tool doesn't need special-case logic for since it's just another named instance.

**Effort:** small — pure wiring, no new service logic, ~40 lines.

---

## 2. Freshness-based cache invalidation — pattern for future cached tools

### Current state
now-mcp's two existing caches are both flat TTL, no signal-based invalidation:
- `src/resources/index.ts`: `tableNameCache` (table-name completion), `TABLE_CACHE_TTL_MS = 60_000`
- `src/prompts/index.ts`: `scopeCache` (scope completion), `SCOPE_CACHE_TTL_MS = 60_000`

Both just check `Date.now() - cached.at < TTL_MS` — correct for a cheap completion list where staleness for up to 60s is harmless, but not accurate: a change made 5 seconds ago is invisible until the 60s window rolls over, and an instance that hasn't changed in an hour still gets re-queried every 60s.

### Reference implementation (fde-mcp)
`src/tools/diagnostics/appArchitectureScan/freshness.ts` — `checkFreshness(client, scope, scopeSysId)`:
1. If instance URL differs from what's recorded in the cached metadata → stale (user switched instances)
2. Else query `sys_update_xml` for the most recent `sys_updated_on` in that scope's update sets — if newer than the cached scan timestamp → stale
3. Only if that query fails does it fall back to a flat time-based staleness check (60 min)

This is real invalidation (did the underlying data actually change?) rather than a guess (did enough wall-clock time pass?).

### Where now-mcp would apply this
**Not a fix to the existing two caches** — those are low-stakes completion lists where flat TTL is a fine tradeoff and adding `sys_update_xml` checks would be over-engineering for a 60s-blast-radius feature.

The pattern becomes relevant if/when now-mcp adds any **expensive, cacheable, multi-query tool** — the most likely candidate being the "instance health check" tool from Recommendation... (see companion note: now-mcp currently has no health-check tool at all, per the earlier now-mcp-vs-forge comparison). If such a tool is built, its cache layer should adopt this 3-step check:

```ts
// src/utils/scan-freshness.ts (new, generic — not tied to one tool)
export async function checkScanFreshness(
  tableService: TableService,
  cached: { instanceUrl: string; scannedAt: string; scopeSysId?: string },
  currentInstanceUrl: string,
): Promise<{ isFresh: boolean; reason: string }> {
  if (normalizeUrl(cached.instanceUrl) !== normalizeUrl(currentInstanceUrl)) {
    return { isFresh: false, reason: 'Instance changed since last scan.' };
  }
  if (cached.scopeSysId) {
    try {
      const rows = await tableService.queryRecords('sys_update_xml', {
        query: `update_set.application=${cached.scopeSysId}^ORDERBYDESCsys_updated_on`,
        fields: ['sys_updated_on'],
        limit: 1,
      });
      if (rows[0] && new Date(rows[0].sys_updated_on) > new Date(cached.scannedAt)) {
        return { isFresh: false, reason: `Instance updated (${rows[0].sys_updated_on}) since last scan.` };
      }
      if (rows[0]) return { isFresh: true, reason: 'No changes since last scan.' };
    } catch { /* fall through to time-based check below */ }
  }
  const ageMinutes = (Date.now() - new Date(cached.scannedAt).getTime()) / 60_000;
  return ageMinutes > 60
    ? { isFresh: false, reason: `Cached scan is ${Math.round(ageMinutes)} min old.` }
    : { isFresh: true, reason: `Cached scan is ${Math.round(ageMinutes)} min old (within window).` };
}
```

**Explicitly not recommended:** porting fde-mcp's *judgment* layer (the hardcoded recommendation thresholds in `agenticAdvisor.ts`, e.g. `volume > 100 && fields.length >= 2 → recommend Triage Agent`). Only the freshness-check *mechanism* is worth reusing — any future now-mcp health/scan tool should return raw facts and let the model/skill reason about them, not bake judgment into TypeScript.

**Effort:** no immediate action item — this is a "when you build X, use this pattern" note, not a standalone task. Flagged here so it isn't reinvented as flat TTL when the health-check tool eventually gets built.

---

## 3. Four new read-only tools

All four are pure data-gathering (no writes), don't overlap an existing now-mcp tool, and don't touch Fluent-owned structural metadata — they pass the "senses, not hands" test cleanly.

### 3a. `diff_records`

**Gap:** No way to compare two records field-by-field in one call today; the model would have to fetch both via `query_records` and diff them itself in-context, which is wasteful for wide tables.

**fde-mcp reference** (`building-blocks/diffRecords.ts`, `fde_diff_records`):
- Input: `table`, `sys_id_a`, `sys_id_b`, optional `fields` (comma-separated allowlist)
- Fetches both records in parallel (`Promise.all`), takes the union of field keys from both, and for each key does `JSON.stringify(valA) !== JSON.stringify(valB)` — handles reference-field objects and mismatched types correctly since it's a structural compare, not a `===`
- Returns only the differing fields as `{ [field]: { a, b } }`, plus `total_fields_compared` / `fields_changed` counts

**now-mcp implementation:**
```ts
// src/schemas/diff-schemas.ts
export const DiffRecordsSchema = z.object({
  tableName: z.string(),
  sysIdA: z.string(),
  sysIdB: z.string(),
  fields: z.array(z.string()).optional().describe('Limit comparison to these fields; omit to compare all returned fields'),
  instance: z.string().optional(),
});
export const DiffRecordsOutputSchema = z.object({
  success: z.boolean(),
  table: z.string(),
  fieldsCompared: z.number(),
  fieldsChanged: z.number(),
  diffs: z.record(z.object({ a: z.unknown(), b: z.unknown() })),
});
```
```ts
// src/tools/diff-records-tool.ts
export function createDiffRecordsTool(tableService: TableService) {
  return {
    name: 'servicenow_diff_records',
    title: 'Diff records',
    description: `What: Compare two records from the same table field-by-field; returns only the fields that differ.
When to use: Comparing before/after state of a Fluent-deployed record, or two similar records to find configuration drift.
Preconditions: Both sys_ids must exist on the given table.
Produces: The set of differing fields with each record's value.

Example:
- tableName="sys_dictionary", sysIdA="<before>", sysIdB="<after>"`,
    inputSchema: DiffRecordsSchema,
    outputSchema: DiffRecordsOutputSchema,
    handler: async (params: unknown) => {
      try {
        const { tableName, sysIdA, sysIdB, fields, instance } = DiffRecordsSchema.parse(params);
        const [recordA, recordB] = await Promise.all([
          tableService.getRecord(tableName, sysIdA, fields, instance),
          tableService.getRecord(tableName, sysIdB, fields, instance),
        ]);
        if (!recordA || !recordB) {
          const missing = !recordA ? sysIdA : sysIdB;
          return toolError(new Error(`Record not found: ${tableName}/${missing}`), { table: tableName });
        }
        const allKeys = new Set([...Object.keys(recordA), ...Object.keys(recordB)]);
        const diffs: Record<string, { a: unknown; b: unknown }> = {};
        for (const key of allKeys) {
          if (JSON.stringify(recordA[key]) !== JSON.stringify(recordB[key])) {
            diffs[key] = { a: recordA[key], b: recordB[key] };
          }
        }
        const response = { success: true, table: tableName, fieldsCompared: allKeys.size, fieldsChanged: Object.keys(diffs).length, diffs };
        return { content: [{ type: 'text' as const, text: toolText(response) }], structuredContent: response };
      } catch (error) {
        return toolError(error, { operation: 'diff records' });
      }
    },
  };
}
```
**Dependency note:** requires `TableService.getRecord(table, sysId, fields?, instance?)` — check whether `TableService` already has a single-record getter (`query_records` with `limit: 1` likely underlies `create-record-tool`'s existing-record checks); if not, add a thin wrapper rather than duplicating query logic.

**Effort:** small, ~1 new file + 1 schema file, reuses existing table-read plumbing.

---

### 3b. `get_table_structure_from_data`

**Gap:** `servicenow_get_table_schema` reads `sys_dictionary` — correct for tables with proper metadata, but silently thin for tables where the dictionary is incomplete (common on legacy/import-set-derived tables, or tables modified outside Studio). No fallback exists today; the model has no way to ask "what does this table actually look like based on its data."

**fde-mcp reference** (`building-blocks/getTableStructureFromData.ts`, `fde_get_table_structure_from_data`):
- Input: `table`, `sample_size` (default 5, max 20)
- Samples N records, then per field across the sample: tracks `seen_count`, `non_empty_count`, a `Set` of inferred types (via regex heuristics: 32-hex → `sys_id`, `YYYY-MM-DD HH:MM:SS` → `glide_date_time`, object with `.link`/`.display_value` → `reference`, extracts the referenced table from the `link` URL), and up to 3 sample values
- Output groups fields into `always_populated`, `never_populated`, `reference_fields` (with inferred target table), plus per-field `populated_ratio` (e.g. `"4/5"`)

**now-mcp implementation:**
```ts
// src/schemas/table-structure-schemas.ts
export const GetTableStructureFromDataSchema = z.object({
  tableName: z.string(),
  sampleSize: z.number().int().min(1).max(20).default(5),
  instance: z.string().optional(),
});
export const GetTableStructureFromDataOutputSchema = z.object({
  success: z.boolean(),
  table: z.string(),
  recordsSampled: z.number(),
  alwaysPopulated: z.array(z.string()),
  neverPopulated: z.array(z.string()),
  referenceFields: z.array(z.object({ field: z.string(), referencesTable: z.string().optional() })),
  fields: z.array(z.object({
    name: z.string(),
    inferredType: z.string(),
    populatedRatio: z.string(),
    isReference: z.boolean(),
    sampleValues: z.array(z.string()),
  })),
});
```
```ts
// src/services/table-structure-service.ts — new, small: type inference is pure logic, keep it out of the tool file
export function inferFieldType(value: unknown): string {
  if (value == null || value === '') return 'unknown';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.link && v.value) return 'reference';
    if (v.display_value !== undefined) return 'reference';
    return 'object';
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return 'glide_date_time';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'glide_date';
  if (/^[0-9a-f]{32}$/.test(s)) return 'sys_id';
  if (s === 'true' || s === 'false') return 'boolean';
  if (/^\d+$/.test(s) && s.length < 10) return 'integer';
  if (/^\d+\.\d+$/.test(s)) return 'decimal';
  return 'string';
}
// analyzeTableStructure(records: Record<string, unknown>[]) -> the fieldStats aggregation, mirroring
// fde-mcp's logic almost verbatim (it's already table-service-agnostic pure data transformation).
```
The tool itself just calls `tableService.queryRecords(tableName, { limit: sampleSize }, instance)` and pipes the result through `analyzeTableStructure`.

**Effort:** small-medium — mostly porting fde-mcp's inference logic (it's dependency-free pure functions, trivial to translate), plus one thin tool file.

---

### 3c. `get_security_info`

**Gap:** No consolidated way to answer "what protects this table" — ACLs, data policies, and security-relevant business rules each live on different tables (`sys_security_acl`, `sys_data_policy2`, `sys_script`) with no existing now-mcp tool wrapping any of them. Relevant for Fluent work when deciding whether a generated table needs an explicit ACL or `CrossScopePrivilege`, or auditing what already guards a table before adding cross-scope access.

**fde-mcp reference** (`building-blocks/getSecurityInfo.ts`, `fde_get_security_info`) — five parallel/sequential sub-queries, all wrapped in a `safeQuery` helper that swallows per-query errors into a `query_error` field rather than failing the whole tool:
1. `sys_security_acl` where `name=<table>^ORnameLIKE<table>.` (table-level + field-level, the `.` distinguishes `incident` from `incident.field`)
2. `sys_security_acl_role` for the ACLs found above (role requirements), batched to the first 20 ACL sys_ids to stay within query length limits
3. `sys_data_policy2` where `model_table=<table>^active=true`
4. `sys_script` (business rules) where `collection=<table>^active=true` AND script contains `gs.hasRole`/`gs.getUser`/`current.setAbortAction` (heuristic for "security-relevant")
5. `sys_script_client` where `table=<table>^active=true^scriptLIKEg_user.hasRole`

Output groups ACLs by operation, table-level vs field-level counts, active/inactive counts.

**now-mcp implementation:** this is the most substantial of the four — it's a fan-out of `TableService.queryRecords` calls, so no new service is strictly needed, just a tool that orchestrates existing `queryRecords`:
```ts
// src/schemas/security-info-schemas.ts
export const GetSecurityInfoSchema = z.object({
  tableName: z.string(),
  instance: z.string().optional(),
});
export const GetSecurityInfoOutputSchema = z.object({
  success: z.boolean(),
  table: z.string(),
  acls: z.object({ total: z.number(), byOperation: z.record(z.number()), tableLevel: z.number(), fieldLevel: z.number(), details: z.array(z.record(z.unknown())) }),
  roleRequirements: z.array(z.object({ acl: z.string(), role: z.string() })),
  dataPolicies: z.array(z.record(z.unknown())),
  securityBusinessRules: z.array(z.record(z.unknown())),
});
```
```ts
// src/tools/get-security-info-tool.ts — sketch
export function createGetSecurityInfoTool(tableService: TableService) {
  return {
    name: 'servicenow_get_security_info',
    title: 'Get table security info',
    description: `What: Consolidated security posture for a table — ACLs (table + field level), role requirements, active data policies, and security-relevant business rules.
When to use: Before adding CrossScopePrivilege or an ACL for a Fluent-generated table, to see what already guards it; or auditing why access to a table is unexpectedly denied.
Preconditions: Read access to sys_security_acl, sys_data_policy2, sys_script (a missing permission on any one degrades that section, not the whole call).
Produces: ACLs grouped by operation/level, role requirements per ACL, data policies, and security business rules. Per-section query_error field if that section's query failed.`,
    inputSchema: GetSecurityInfoSchema,
    outputSchema: GetSecurityInfoOutputSchema,
    handler: async (params: unknown) => {
      const { tableName, instance } = GetSecurityInfoSchema.parse(params);
      const safeQuery = async (table: string, query: string, fields: string[], limit: number) => {
        try { return { records: await tableService.queryRecords(table, { query, fields, limit }, instance) }; }
        catch (err) { return { records: [], error: err instanceof Error ? err.message : String(err) }; }
      };
      const [acls, dataPolicies, securityBRs] = await Promise.all([
        safeQuery('sys_security_acl', `name=${tableName}^ORnameLIKE${tableName}.`, ['sys_id','name','operation','type','active'], 100),
        safeQuery('sys_data_policy2', `model_table=${tableName}^active=true`, ['sys_id','short_description','enforce_ui','enforce_scripting'], 50),
        safeQuery('sys_script', `collection=${tableName}^active=true^scriptLIKEgs.hasRole^ORscriptLIKEgs.getUser`, ['sys_id','name','when'], 30),
      ]);
      const aclSysIds = acls.records.map((r) => r.sys_id as string).slice(0, 20);
      const roleRequirements = aclSysIds.length
        ? await tableService.queryRecords('sys_security_acl_role', {
            query: aclSysIds.map((id) => `sys_security_acl=${id}`).join('^OR'),
            fields: ['sys_security_acl', 'sys_user_role'],
            limit: 200,
          }, instance)
        : [];
      // ... assemble response, same shape as fde-mcp's summary object
    },
  };
}
```

**Effort:** medium — five sub-queries + assembly logic, but zero new service-layer plumbing since `TableService.queryRecords` already exists; mostly a matter of porting fde-mcp's query strings and response shaping.

---

### 3d. `get_attachment_metadata`

**Gap:** now-mcp's only attachment tool is `servicenow_download_attachment`, which fetches and base64-encodes the actual file content (`src/tools/download-attachment-tool.ts`). There's no lightweight way to ask "what attachments exist on this record" without paying for a full content download — wasteful when the model just needs to know if/how many attachments exist, their names, sizes, and types before deciding whether to download one.

**fde-mcp reference** (`building-blocks/getAttachmentMetadata.ts`, `fde_get_attachment_metadata`):
- Input: either `attachment_sys_id` directly, OR `table_name` + `record_sys_id` to list all attachments on a record
- Delegates to `client.getAttachmentMetadata(tableName, recordSysId, attachmentSysId)` — a query against `sys_attachment` (implied; not shown in this file but standard table)
- Returns `file_name`, `content_type`, `size_bytes`, `created_on`, `created_by`, `compressed`, `hash` per attachment — no content

**now-mcp implementation:** now-mcp already has an `AttachmentService` (used by both upload/download tools) — this is a new method on that service plus a new thin tool:
```ts
// src/schemas/attachment-schemas.ts (add)
export const GetAttachmentMetadataSchema = z.object({
  attachmentSysId: z.string().optional(),
  tableName: z.string().optional(),
  recordSysId: z.string().optional(),
  instance: z.string().optional(),
}).refine(
  (v) => v.attachmentSysId || (v.tableName && v.recordSysId),
  { message: 'Provide either attachmentSysId, or both tableName and recordSysId.' },
);
export const GetAttachmentMetadataOutputSchema = z.object({
  success: z.boolean(),
  totalAttachments: z.number(),
  attachments: z.array(z.object({
    sysId: z.string(), fileName: z.string(), contentType: z.string(),
    sizeBytes: z.number(), createdOn: z.string(), createdBy: z.string(),
  })),
});
```
```ts
// src/services/attachment-service.ts — add method
async getAttachmentMetadata(tableName?: string, recordSysId?: string, attachmentSysId?: string, instance?: string) {
  const query = attachmentSysId
    ? `sys_id=${attachmentSysId}`
    : `table_name=${tableName}^table_sys_id=${recordSysId}`;
  return this.tableService.queryRecords('sys_attachment', {
    query,
    fields: ['sys_id', 'file_name', 'content_type', 'size_bytes', 'table_name', 'table_sys_id', 'sys_created_on', 'sys_created_by', 'compressed', 'hash'],
    limit: 50,
  }, instance);
}
```
Tool file mirrors `download-attachment-tool.ts`'s structure but calls the new service method and skips the base64/content path entirely (so its output is always small — no need for the download tool's structuredContent-only-for-large-payload pattern).

**Effort:** small — one service method (reusing existing `queryRecords` against `sys_attachment`) + one tool file.

---

## Summary

| Item | Type | Effort | New files |
|---|---|---|---|
| `switch_default_instance` | wire-up (logic exists) | Small | 1 tool + 1 schema |
| Freshness-based cache pattern | design note, no immediate action | — | (applies when health-check tool is built) |
| `diff_records` | new tool | Small | 1 tool + 1 schema |
| `get_table_structure_from_data` | new tool | Small–Medium | 1 tool + 1 schema + 1 small service (type inference) |
| `get_security_info` | new tool | Medium | 1 tool + 1 schema |
| `get_attachment_metadata` | new tool | Small | 1 tool + 1 schema + 1 service method |

**Explicitly out of scope** (would violate now-mcp's "senses, not hands" principle by writing structural metadata directly, bypassing Fluent): fde-mcp's `create_application`, `create_script_include`, `create_table_acl`, `app_creator_table_ops`, `ship_update_set`, `deploy_script_runner`. These solve real problems in fde-mcp's context but now-mcp already made a deliberate architectural choice to route all structural writes through the Fluent SDK instead.
