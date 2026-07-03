---
name: servicenow-fluent-dev
description: Use when developing a ServiceNow app with the Fluent SDK (now-sdk) alongside this MCP server — or whenever a now.config.json is present at the project root. Authoring config-as-code, deploying, and verifying it against a live instance. Encodes the read-schema → write-Fluent → deploy → verify → drift loop and the division of labour between now-sdk and the MCP.
---

# ServiceNow Fluent development loop

You have two complementary capabilities. Use each for what it's good at — and
**don't reinvent one with the other.** now-sdk already talks to the instance
(read + capture); the MCP does the things now-sdk can't.

- **now-sdk + Bash (the hands)** — author app metadata as TypeScript (`*.now.ts`),
  `now-sdk build` / `now-sdk deploy`. It also **reads** the instance
  (`now-sdk query`) and **captures** config to Fluent (`now-sdk transform`).
- **This MCP (the senses + test harness)** — aggregation, data writes, running
  server-side scripts, and seeding/discarding test data. The MCP does **not**
  author metadata, and does not duplicate now-sdk's reads.

## Division of labour — route each job to the right tool

| Job | Use | Why |
|---|---|---|
| Sample a few rows while authoring in a Fluent project | **`now-sdk query <table> -o json`** (4.8.0) | Already aligned to your deploy instance via its auth alias — no instance-mismatch risk while you write Fluent |
| Read records with no now-sdk project context | **`servicenow_query_records`** | The read path when you're not inside a Fluent project; also the substrate for aggregation and post-deploy verification reads |
| Capture existing instance config → Fluent | **`now-sdk transform --table <t>`** | Real XML→Fluent with relationships; do not hand-roll this |
| Read table schema / choices | `servicenow_get_table_schema`, `servicenow_get_choice_list` | Quick field/type/reference lookup before writing Fluent |
| Author metadata (tables, BRs, ACLs, UI policies…) | **Fluent `*.now.ts`** + `now-sdk deploy` | Source-controlled; never POST metadata to tables |
| **Counts / group-by / avg-sum** | **`servicenow_aggregate_records`** | now-sdk query can't aggregate |
| **Write/patch/delete data rows** | **`servicenow_create_record` / `update` / `delete` / `batch_*`** | now-sdk only writes app metadata, not data |
| **Run server-side script to exercise behavior** | **`servicenow_execute_background_script`** | now-sdk has no script execution |
| Confirm both point at the same instance | **`servicenow_sdk_status`** | Catches "deployed to dev, queried prod" |

Rule of thumb: **while authoring in a Fluent project, sample rows with `now-sdk
query` (auto-aligned to the deploy instance); Fluent capture → now-sdk;
aggregation, post-deploy verification reads, reads with no now-sdk project
context, writes, script-execution, and test-data → MCP.** `servicenow_query_records`
stays the verification + aggregation substrate — don't drop it; just prefer
`now-sdk query` for the quick "what's in this table" peek while you write Fluent.
If you reach for a `create_*` metadata tool, stop — write Fluent instead.

## The loop

### 0. Align first
Run `servicenow_sdk_status` once. It reports the now-sdk version, its auth
profiles, and whether the MCP's configured instance matches one. If `aligned` is
false, fix it before trusting any verification (you'd be deploying and verifying
different instances).

### 1. Read the real schema before writing Fluent
Don't guess field names. Pull ground truth:
- `servicenow_get_table_schema` — fields, types, references, mandatory/read-only.
- `servicenow_get_choice_list` — valid choice values for a choice field.
- For a quick row sample while authoring, `now-sdk query <table> -q <encoded> -o json`
  (4.8.0; auto-aligned to your deploy instance). Save `servicenow_query_records`
  for aggregation, post-deploy verification, and reads outside a now-sdk project.

### 2. Write the Fluent code
Edit the `*.now.ts` files. Match the project's existing scope and patterns
(`now.config.json` holds the scope). For correct column names/types/references,
lean on step 1's schema read.

### 3. Build and deploy (Bash)
```bash
now-sdk build
now-sdk deploy            # deploys to the authed instance
```

### 4. Verify against the live instance (MCP's job)
Deploy success ≠ correct behavior. Use the MCP to prove it. (Shortcut: the
`verify_fluent_deploy` MCP **prompt** packages these steps — pass your scope.)

- **Scope-aware inventory** — confirm the app's artifacts landed by querying
  `sys_metadata` filtered to the app scope (read `scope` from `now.config.json`):
  ```
  servicenow_aggregate_records  tableName=sys_metadata
    query="sys_scope.scope=<scope>"  groupBy=["sys_class_name"]
  ```
  Then `servicenow_query_records` on `sys_metadata` (same query) to see specific
  records, or re-read a changed table with `servicenow_get_table_schema`.
- **Exercise behavior** — `servicenow_execute_background_script` to trigger the
  logic, then `servicenow_query_records` on `syslog` (`level=error`, recent) to
  read output/errors.
- **Exercise with data** — seed a few rows with `servicenow_create_record` /
  `servicenow_batch_create`, check rollups with `servicenow_aggregate_records`,
  then clean up with `servicenow_delete_record`. Test data is *data*, not config.

### 4b. If the deploy FAILED (diagnose)
now-sdk's CLI error is often opaque; the instance knows more. (Shortcut: the
`diagnose_deploy_failure` MCP prompt.)
- `servicenow_query_records` on `syslog` (`level=error`, newest first) around the
  deploy time for the underlying error.
- Check `sys_update_xml` / `sys_metadata` in the scope for partially-applied records.
- Reproduce runtime errors with `servicenow_execute_background_script` and read
  `gs.log`. Then fix the **Fluent source** and redeploy — never hand-patch the instance.

### 5. Drift check
You hold both sides — the Fluent source and (via the MCP) the live state. Read
the live app inventory scoped to your app:
```
servicenow_query_records  tableName=sys_metadata
  query="sys_scope.scope=<scope>"  fields=["sys_class_name","sys_name","sys_updated_on","sys_updated_by"]
```
Diff that against your `*.now.ts`. A record updated by a human (not your deploy)
is **drift** — reconcile by updating the Fluent source and redeploying, never by
treating the instance as the source of truth.

## Reverse-engineering existing config into Fluent
To bring un-source-controlled config under Fluent, use now-sdk — it does this
properly; don't hand-translate:
```bash
now-sdk transform --table <table>           # capture a table's config to Fluent
now-sdk transform --table <table> --id <id> # one record + its relationships
```
Then review the generated `*.now.ts`, deploy to a dev instance, and verify
(step 4) that behavior matches.

## Instance hygiene
- Run `servicenow_sdk_status` to confirm the MCP and now-sdk target the same host.
- Configure the MCP with any one of: a `config/servicenow-instances.yaml`, a
  one-line `SERVICENOW_URL="https://user:pass@host"`, or `SERVICENOW_INSTANCE_ALIAS`
  (takes the instance URL from a now-sdk profile; password still via
  `SERVICENOW_PASSWORD`, since now-sdk keeps secrets in the OS keychain).
- Prefer a non-production instance for the author→deploy→verify loop.

## Drop this into your Fluent project's CLAUDE.md
So Claude Code splits the work correctly every session, paste this into the
project that has both now-sdk and now-mcp:

```md
## ServiceNow tooling: now-sdk + now-mcp work together
- Authoring/deploying app metadata and reading the instance → **now-sdk**
  (`now-sdk build/deploy`, `now-sdk query`, `now-sdk transform`).
- Aggregation, data writes, and server-side script execution → **now-mcp**
  (`servicenow_aggregate_records`, `servicenow_create/update/delete_record`,
  `servicenow_batch_*`, `servicenow_execute_background_script`).
- Run `servicenow_sdk_status` to confirm both point at the same instance before
  trusting a deploy verification.
- Never POST metadata to tables — author it in Fluent.
```
