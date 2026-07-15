## Fluent workflow

**For every Fluent SDK authoring or `*.now.ts` API question, use `now-sdk explain`
first.** This includes imports, exported names, types, constructors, signatures,
fields, and code examples—not only the moment immediately before writing code.
Its installed-version reference is authoritative for Fluent APIs. Pass any name
related to the task (a partial API name, class, or field type); don't guess from
memory:

```
now-sdk explain --list --format=raw          # full topic index
now-sdk explain <topic> --peek --format=raw  # preview
now-sdk explain <topic> --format=raw         # full content
```

**Routing precedence:** `now-sdk explain` wins over `sn-docs-search` for Fluent
SDK/API and `*.now.ts` questions. Use `sn-docs-search` for product behavior,
administration/configuration, or release documentation outside the SDK API
reference. Being inside a Fluent app does not by itself justify a docs search.

## Division of Labor among now-sdk, now-mcp, and skills
- **Fluent SDK (`now-sdk`) — AUTHOR.** Defines what the application *is*: tables,
  business rules, UI policies, workflows, ACLs, script includes. Written as
  TypeScript source (`*.now.ts`) → `build` → `deploy`. The **source of truth is
  git**; the instance is a deployment artifact.
- **now-mcp — OPERATE.** Acts on the *running* instance: read data
  (query/aggregate/schema), **write data rows** (create/update/delete/batch),
  run scripts, move files. It never defines the application. Data yes, config no.
- **Workflow rules + skills — ORCHESTRATE.** Know *how* to combine the two to get
  work done (order, judgement, when to use which). They add no new capability —
  just method. 

```
Skill (orchestrate) ──drives──▶ SDK (author config)  +  MCP (operate runtime)
                                        │                        │
                                        └──── both act on ───────┘
                                              the instance
```

After a deploy, check-in with user whether to verify against the live instance (deploy success ≠ correct
behavior): the `verify_fluent_deploy` MCP prompt packages the checks; the
`diagnose_deploy_failure` prompt helps when a deploy fails. On drift (a scoped
record changed by a human, not your deploy), reconcile by updating the Fluent
source and redeploying — never treat the instance as the source of truth.

## Server-side script conventions (background scripts & Script Includes)
- **Log with `gs.info(...)`, never `gs.print(...)`.** `gs.print` is a global-scope-only
  API — in a scoped Script Include or scoped background script it is blocked (the call
  fails or is silently swallowed). Default to `gs.info(...)` everywhere; it works in both
  global and scoped contexts. Output lands in **System Logs → System Log (syslog)**, not
  the background-script result panel. (The `sn_execute_background_script` MCP tool
  auto-rewrites `gs.print`/`gs.info`/`gs.log` to its capture helper, so its result panel
  still shows output — but write `gs.info` in the source you keep.)

Project Specific Architecture & Design to be defined in `README.md`

