**Before writing ANY Fluent (`*.now.ts`) code, run `now-sdk explain <topic>`** to
get the authoritative signature — pass any name related to what you're writing (a
partial API name, a class, a field type). Don't guess API names or type imports
from memory:

```
now-sdk explain --list --format=raw          # full topic index
now-sdk explain <topic> --peek --format=raw  # preview
now-sdk explain <topic> --format=raw         # full content
```

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


Project Specific Architecture & Design to be defined in `README.md`