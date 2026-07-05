## Fluent workflow (injected by the `fluent` Claude Code plugin)

<!-- Edit freely — the hook respects your changes and won't overwrite. Silence it with FLUENT_BOOTSTRAP_CLAUDEMD=off. -->

You have two complementary capabilities. Use each for what it's good at — do NOT
reinvent one with the other. now-sdk already talks to the instance (read +
capture); the MCP does what now-sdk can't (aggregate, write data, run scripts).

**Before writing ANY Fluent (`*.now.ts`) code, run `now-sdk explain <topic>`** to
get the authoritative signature — pass any name related to what you're writing (a
partial API name, a class, a field type). Don't guess API names or type imports
from memory.

**Route each job to the right tool:**

| Job | Use |
|---|---|
| Author metadata (tables, business rules, ACLs, UI policies…) | **Fluent `*.now.ts`** + `now-sdk build` / `now-sdk deploy` — never POST metadata to tables or reach for a `create_*` metadata tool |
| Capture existing instance config → Fluent | `now-sdk transform --table <t>` (real XML→Fluent with relationships; don't hand-roll) |
| Sample a few rows while authoring in a Fluent project | `now-sdk query <table> -o json` (auto-aligned to your deploy instance) |
| Aggregation (counts / group-by / sum) | `servicenow_aggregate_records` |
| Write/patch/delete data rows; seed & clean up test data | `servicenow_create_record` / `update` / `delete` / `batch_*` (test data is *data*, not config) |
| Run a server-side script to exercise behavior | `servicenow_execute_background_script` |
| Read table schema / choices | `servicenow_get_table_schema`, `servicenow_get_choice_list` |
| Post-deploy verification reads; reads outside a now-sdk project | `servicenow_query_records` |
| Confirm the MCP and now-sdk point at the same instance | `servicenow_sdk_status` |

After a deploy, verify against the live instance (deploy success ≠ correct
behavior): the `verify_fluent_deploy` MCP prompt packages the checks; the
`diagnose_deploy_failure` prompt helps when a deploy fails. On drift (a scoped
record changed by a human, not your deploy), reconcile by updating the Fluent
source and redeploying — never treat the instance as the source of truth.
