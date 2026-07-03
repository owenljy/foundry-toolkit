/**
 * Eval fixtures (WS-B §4.3).
 *
 * - TASKS: the curated natural-language ask → expected tool + key params set.
 * - BEFORE_DESCRIPTIONS: the verbose, pre-cleanup descriptions of the three
 *   eval-target tools, frozen here so the before/after delta is reproducible in
 *   a single `node --test` run. The AFTER descriptions are read live from the
 *   built tool modules by the test, so the harness can't drift from shipped code.
 */

/** Tables/fields the param extractor is allowed to recognise. */
export const KNOWN_TABLES = [
  'incident', 'sys_user', 'change_request', 'problem', 'task', 'cmdb_ci',
];
export const KNOWN_FIELDS = ['priority', 'state', 'type', 'category', 'urgency', 'impact'];

/**
 * Curated task set. Each maps an ask to the tool an agent should pick and the
 * key params it should lift from the ask. Covers query_records,
 * aggregate_records and get_table_schema (the §4.3 targets), with a few
 * neighbours so the router has realistic competition.
 */
export const TASKS = [
  // --- query_records: retrieve rows ---
  {
    ask: 'Show me the open incidents assigned to the network team',
    expectedTool: 'servicenow_query_records',
    expectedParams: { tableName: 'incident' },
    hints: { knownTables: KNOWN_TABLES },
  },
  {
    ask: 'Fetch the most recent change_request rows so I can read their descriptions',
    expectedTool: 'servicenow_query_records',
    expectedParams: { tableName: 'change_request' },
    hints: { knownTables: KNOWN_TABLES },
  },
  {
    ask: 'Retrieve the active sys_user rows with their email addresses',
    expectedTool: 'servicenow_query_records',
    expectedParams: { tableName: 'sys_user' },
    hints: { knownTables: KNOWN_TABLES },
  },
  {
    ask: 'Pull the unassigned critical incident rows, paginated 50 at a time',
    expectedTool: 'servicenow_query_records',
    expectedParams: { tableName: 'incident' },
    hints: { knownTables: KNOWN_TABLES },
  },

  // --- aggregate_records: counts / group-by / rollups ---
  {
    ask: 'How many open incidents are there per assignment group?',
    expectedTool: 'servicenow_aggregate_records',
    expectedParams: { tableName: 'incident' },
    hints: { knownTables: KNOWN_TABLES },
  },
  {
    ask: 'What is the average reassignment count across active incidents?',
    expectedTool: 'servicenow_aggregate_records',
    expectedParams: { tableName: 'incident' },
    hints: { knownTables: KNOWN_TABLES },
  },
  {
    ask: 'Give me the total count of change_request grouped by type',
    expectedTool: 'servicenow_aggregate_records',
    expectedParams: { tableName: 'change_request' },
    hints: { knownTables: KNOWN_TABLES },
  },

  // --- get_table_schema: field definitions for one table ---
  {
    ask: 'What fields and data types does the incident table define?',
    expectedTool: 'servicenow_get_table_schema',
    expectedParams: { tableName: 'incident' },
    hints: { knownTables: KNOWN_TABLES },
  },
  {
    ask: 'Describe the column definitions and constraints of change_request',
    expectedTool: 'servicenow_get_table_schema',
    expectedParams: { tableName: 'change_request' },
    hints: { knownTables: KNOWN_TABLES },
  },
  {
    ask: 'Which mandatory and readonly fields exist on the sys_user table?',
    expectedTool: 'servicenow_get_table_schema',
    expectedParams: { tableName: 'sys_user' },
    hints: { knownTables: KNOWN_TABLES },
  },
];

/** Frozen pre-cleanup descriptions of the three eval-target tools. */
export const BEFORE_DESCRIPTIONS = {
  servicenow_query_records: `What: Read records from any ServiceNow table with filters, field selection, dot-walking, and pagination.
When to use: To retrieve rows of data. For counts/group-by/avg/sum use servicenow_aggregate_records instead.
Preconditions: Table must exist; the account needs read access to it.
Produces: An array of records (plus pagination metadata, and recovery hints when empty).

Query records from any ServiceNow table with optional filters and pagination.

Encoded Query Examples:
- Query all priority 1 incidents: tableName="incident", query="priority=1"
- Get open incidents for a user: tableName="incident", query="assigned_to=USER_SYS_ID^state=2"
- List all active users: tableName="sys_user", query="active=true"
- Query with pagination: tableName="incident", limit=50, offset=100
- Get specific fields only: tableName="incident", fields=["number", "short_description", "priority"]

Encoded query operators:
- = (equals), != (not equals)
- ^ (AND), ^OR (OR)
- >, <, >=, <= (comparisons)
- LIKE, STARTSWITH, ENDSWITH (string matching)
- IN (list matching)

Dot-walking: traverse reference fields with dots in both queries and fields,
e.g. query="caller_id.department.name=Network", fields=["number","caller_id.name","caller_id.department.manager.email"].

Display values: set displayValue=true for human-readable labels of
reference/choice fields (group name instead of sys_id), or "all" for both.

For counts, group-by, and avg/sum/min/max use servicenow_aggregate_records
instead — it computes the numbers server-side rather than returning rows.`,

  servicenow_aggregate_records: `What: Compute counts and avg/sum/min/max over a table via the Stats API, optionally grouped (group-by supports dot-walking).
When to use: For "how many", "per group", or numeric rollups — not when you need the actual rows (use servicenow_query_records for those).
Preconditions: Table must exist; the account needs read access.
Produces: Aggregate numbers (a single object, or an array of groups when groupBy is set).

Aggregate records from any ServiceNow table using the Stats API — counts and avg/sum/min/max over fields, optionally grouped. Returns computed numbers, not raw rows, so it is far cheaper than querying records and reducing them client-side.

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

  servicenow_get_table_schema: `Get detailed schema information for a ServiceNow table including all field definitions, types, and constraints.

This tool enables dynamic discovery of table structure, making it easy to understand what fields are available and their properties without manual documentation lookup.

Features:
- Complete field metadata (name, label, type, mandatory, readonly)
- Field constraints (max length, reference tables)
- Optional inclusion of inherited fields from parent tables
- Cached for performance (15-minute TTL)

Examples:
- Get incident table schema:
  tableName="incident"

- Get schema with inherited fields:
  tableName="incident"
  includeExtended=true

Returns comprehensive field information including data types, labels, constraints, and reference relationships.`,
};
