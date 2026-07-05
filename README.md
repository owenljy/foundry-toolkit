# foundry-suite — Claude's ServiceNow toolkit, built around Fluent (`now-sdk`)

A Claude Code **plugin suite** (`foundry-suite`) for working on ServiceNow the
Fluent way. It ships **two plugins** you can install separately or together, and
it grows over time:

- **`now-mcp`** — a small, trustworthy, **Fluent-native**
  [Model Context Protocol](https://modelcontextprotocol.io) server that lets
  Claude **operate a running ServiceNow instance**: read and write runtime data,
  inspect schema, run scripts, manage attachments. It also carries on-demand
  skills (e.g. `sn-docs-search`) and the Fluent-workflow SessionStart hook.
- **`toolkit`** — skills for the full **ServiceNow AI Agent lifecycle**: build an
  agent as now-sdk Fluent (`sn-aia-agent-builder`), audit it against deployment
  guardrails (`sn-aia-agent-audit`), build eval datasets (`sn-aia-dataset-builder`),
  set up the platform eval pipeline (`sn-eval-runner-builder`), and analyze
  runtime execution traces (`sn-aia-trace-analyzer`). These skills resolve their
  live-instance reads and script execution against whatever ServiceNow MCP is
  connected — `now-mcp` is the natural pair, but not hardcoded.
- **A SessionStart hook** (in `now-mcp`) — when a project is a Fluent app (`now.config.json`
  present), it injects a standing "Fluent workflow" block into that project's
  `CLAUDE.md`: the always-on rules for splitting work between **`now-sdk`** (author
  metadata, capture, reads) and **`now-mcp`** (aggregate, write data, run scripts),
  plus "always `now-sdk explain` before writing Fluent."

Everything here is designed to pair with `now-sdk`: config-as-code is Fluent's
job; operating the live instance is the MCP's; the injected workflow rules keep
Claude splitting the two correctly every session.

## The idea in one paragraph

Three layers, each with one job: **Fluent (`now-sdk`) authors** the application
(tables, business rules, workflows) as source code and deploys it; **`now-mcp`
operates** the running instance (query/aggregate data, read schema, write data
rows, run server-side scripts, manage attachments); **skills orchestrate** the
two into workflows. The line that keeps them apart: **data rows are runtime →
MCP; config/metadata is the app's definition → Fluent source.** That's why the
MCP writes an incident but never a business rule. This repo (`foundry-suite`)
ships the MCP and the skills together as one installable toolkit.

![SDK authors the application, MCP operates the running instance, Skills orchestrate the two — with a "where does it go?" guide](docs/three-layers.png)

---

## Quick start

### Prerequisites
- **Node.js 20+** (matches now-sdk's floor and CI)
- **pnpm via corepack** — run `corepack enable` once (corepack ships with Node); the
  plugin's first-launch bootstrap uses it to install deps at the pinned version
- A **ServiceNow instance** and credentials (basic auth or OAuth)
- *(Optional)* the **`now-sdk`** CLI for the Fluent pairing: `pnpm add -g @servicenow/sdk`

### Install as a Claude Code plugin (recommended)

The suite ships as Claude Code **plugins** from the `foundry-suite`
marketplace — install from git, no manual build. Add the marketplace once, then
install whichever plugins you want:

```
/plugin marketplace add <REPO_URL>
/plugin install now-mcp@foundry-suite      # the MCP server + Fluent skills/hook
/plugin install toolkit@foundry-suite      # the AI Agent lifecycle skills (optional)
/reload-plugins
```

Install `now-mcp` alone for the data/schema/script tools; add `toolkit` when you
work on ServiceNow AI Agents. `toolkit` is skills-only (no setup form) and uses
`now-mcp` for its live-instance reads, so installing both is the usual setup.


When you enable it, Claude Code pops up a **setup form** for connection details.
For a single instance (basic auth), just fill in **instance URL**, **username**,
and **password** — the password is stored in your system keychain, and no config
file is needed. Leave **Read-only** as-is to stay read-only (type `false` to
allow writes). For multi-instance, OAuth, or now-sdk pairing, leave those blank
and set **config file** to the path of a `servicenow-instances.yaml`
(see [Configuration](#configuration)) instead.



---

## Configuration

Two ways to configure, depending on how complex your setup is:

- **Single instance, basic auth (the common case)** — no file needed. As a
  plugin, fill in the instance URL, username, and password in the enable-time
  form; standalone, set `SERVICENOW_URL` / `SERVICENOW_USERNAME` /
  `SERVICENOW_PASSWORD`. The password is kept in your system keychain.
  
- **Multiple instances, OAuth, or now-sdk pairing** — use a **YAML file**
  (below). It's the same format whether you have one instance or many, and it's
  what the plugin's "Config file" field points to.

**YAML setup** — two steps:

```bash
# 1. Copy the example (your copy is git-ignored, so credentials stay local).
#    The template is bundled with the plugin at the same path, and viewable at
#    https://github.com/owenljy/foundry-suite/blob/main/config/servicenow-instances.example.yaml
cp config/servicenow-instances.example.yaml config/servicenow-instances.yaml
# 2. Edit config/servicenow-instances.yaml — the file is commented; the minimal
#    single-instance block at the top is all most setups need.
```

The minimal config is just one instance:

```yaml
instances:
  - name: dev                  # numeric PDI names like 123456 are fine, unquoted
    url: https://dev123456.service-now.com
    auth:
      type: basic              # basic, or oauth (clientId/clientSecret/tokenUrl)
      username: api.user
      password: change-me
    default: true              # exactly one instance must be the default
    readOnly: false            # false = writes on. Omit/true = read-only (safe default)
```

Add more instances (prod, OAuth, etc.) by uncommenting the extras in the example
file. Tools take an optional `instance` argument to target one by `name`;
otherwise the `default` is used. It's YAML (a JSON superset), so comments are
fine and old JSON still parses.

**Auth types** — each instance uses either `basic` (username + password) or
`oauth`. OAuth supports two grant types via `grantType` (defaults to
`client_credentials`):

- `client_credentials` — app-level token from `clientId`/`clientSecret`.
- `password` — user-level token; `username`/`password` are exchanged once for a
  token, then renewed with the returned `refresh_token` (no password re-send).

```yaml
    auth:
      type: oauth
      grantType: password          # or client_credentials (default)
      clientId: your-client-id
      clientSecret: your-client-secret
      tokenUrl: https://dev123456.service-now.com/oauth_token.do
      username: api.user           # required for grantType: password
      password: change-me          # required for grantType: password
      # scope: useraccount         # optional
```

**How config is resolved** — in this order:
1. **`SERVICENOW_CONFIG_PATH`** → a YAML file at any path (use this for a
   global/out-of-repo install), else
2. **`SERVICENOW_URL`** (+ `SERVICENOW_USERNAME` / `SERVICENOW_PASSWORD`) → the
   single-instance **fast path**: one basic-auth instance built straight from
   env vars, no file required. This is what the plugin form feeds. Basic-auth
   single-instance only; use YAML for OAuth or multiple instances. Else
3. **`config/servicenow-instances.yaml`** (or `.yml`) in the working directory.

Without a valid config the server still starts (degraded mode) and reports the
reason (including the working directory and which sources it checked) on each
call, so you can fix it without a crash loop.


---

## Tools

### Data (read & write runtime records)
| Tool | What it does |
|---|---|
| `servicenow_query_records` | Read any table — encoded-query filters, field selection, **dot-walking**, pagination, display values |
| `servicenow_aggregate_records` | Counts / group-by / avg / sum / min / max via the **Stats API** (server-side, cheap) |
| `servicenow_create_record` | Insert a record (with schema field validation + typo hints) |
| `servicenow_update_record` | Patch/replace a record by sys_id |
| `servicenow_delete_record` | Delete a record by sys_id (destructive) |
| `servicenow_batch_create` / `servicenow_batch_update` | Create/update many records in concurrency-limited waves (default 50/call, rate-limited; not transactional) |
| `servicenow_diff_records` | Compare two records on a table field-by-field; returns only what differs |

### Schema discovery
| Tool | What it does |
|---|---|
| `servicenow_get_table_schema` | Fields, types, references, mandatory/read-only (cached) |
| `servicenow_get_table_structure_from_data` | Infer structure by **sampling real rows** — fallback when `sys_dictionary` is thin/incomplete |
| `servicenow_list_tables` | List/filter tables |
| `servicenow_get_choice_list` | Valid choice values for a field |
| `servicenow_get_security_info` | Consolidated table security posture — ACLs (table + field), role requirements, data policies, security business rules |

### Execution & files
| Tool | What it does |
|---|---|
| `servicenow_execute_background_script` | Run server-side JavaScript (exercise deployed logic; read results from logs) |
| `servicenow_upload_attachment` / `servicenow_download_attachment` | Attach / fetch files (base64) |
| `servicenow_get_attachment_metadata` | List attachments on a record (name, type, size) **without** downloading content |

### Instances *(only when more than one instance is configured)*
| Tool | What it does |
|---|---|
| `servicenow_switch_default_instance` | Repoint the session default instance (for calls that omit `instance`) + connectivity probe; in-memory only, no YAML write |

### Fluent SDK bridge *(only when `now-sdk` is installed)*
| Tool | What it does |
|---|---|
| `servicenow_sdk_status` | now-sdk version + auth profiles, and whether the MCP and now-sdk point at the **same instance** |

### Beyond tools
- **Smarter errors** — bad field names are caught before the API call with "did
  you mean…?" hints; 403/404/field errors and empty results come back with
  recovery guidance, not a bare error.
- **Resources** — `servicenow://instances` and a `servicenow://schema/{table}`
  template, so the model can pull context by URI without spending a tool call.
- **Prompts** — canned workflows: `verify_fluent_deploy`, `diagnose_deploy_failure`,
  `investigate_incident`, `cmdb_health_overview`.

---

## How it works with now-sdk

The MCP and `now-sdk` are two halves of one loop. **Don't make one reinvent the
other.**

| Job | Use | Why |
|---|---|---|
| Read records | `now-sdk query` **or** `servicenow_query_records` | now-sdk query is already aligned to your deploy instance |
| Capture instance config → Fluent | **`now-sdk transform`** | Real XML→Fluent with relationships |
| Author metadata (tables, BRs, ACLs…) | **Fluent `*.now.ts`** + `now-sdk deploy` | Source-controlled; never POST metadata |
| Counts / group-by | **`servicenow_aggregate_records`** | now-sdk can't aggregate |
| Write / delete data rows | **`servicenow_create/update/delete_record`** | now-sdk only writes app metadata |
| Run a server-side script | **`servicenow_execute_background_script`** | now-sdk has no script execution |
| Confirm both target the same instance | **`servicenow_sdk_status`** | Avoids "deployed to dev, queried prod" |



### Auto-pairing the instance
By default (`SERVICENOW_FOLLOW_NOW_SDK` on), the active instance follows whichever
profile `now-sdk auth --use` selected — matched by host — so the MCP and Fluent
always target the same instance. List each instance's credentials in the YAML
once; `now-sdk` is the single switch (reconnect the MCP after switching).
`now-sdk` keeps its password in the OS keychain, so the YAML still supplies
credentials. Set `SERVICENOW_FOLLOW_NOW_SDK=false` to pin the YAML `default`, and
use `servicenow_sdk_status` to check alignment.

### Fluent workflow rules (auto-injected)
When a project is a Fluent app (`now.config.json` at its root), a SessionStart
hook (`scripts/bootstrap-fluent-claudemd.mjs`) appends a standing **Fluent
workflow** block to that project's `CLAUDE.md`. Because `CLAUDE.md` is loaded
into every session's system prompt, these rules are always in force — no skill
trigger to miss. The block covers the division of labour above (author metadata &
capture & reads → `now-sdk`; aggregation, data writes, script execution → the
MCP) and the "always `now-sdk explain` before writing Fluent" rule. It's
idempotent (won't stomp your edits) and opt-out via `FLUENT_BOOTSTRAP_CLAUDEMD=off`.
The injected text is not hardcoded — it lives in an editable file
(`scripts/claude-md-template.md`), or point `FLUENT_WORKFLOW_TEMPLATE` at your own
markdown to maintain your team's rules.
The `verify_fluent_deploy` / `diagnose_deploy_failure` MCP **prompts** package the
post-deploy verify and failure-diagnosis steps on demand.


---

## Typical scenarios

**1. "How many P1 incidents per assignment group this week?"**
`servicenow_aggregate_records` with `groupBy: ["assignment_group"]` — one call,
numbers computed server-side, no row-dumping.

**2. Build a Fluent app and prove it works.**
Read schema with the MCP → write `*.now.ts` → `now-sdk deploy` (Bash) →
`servicenow_query_records` to confirm it landed →
`servicenow_execute_background_script` to trigger logic → read `syslog`.

**3. Reverse-engineer legacy config into source control.**
`now-sdk transform --table <t>` to capture to Fluent → MCP reads to verify
behavior matches after redeploy to dev.

**4. Investigate an incident.**
Query the incident, dot-walk to `caller_id.department.manager`, pull related CIs
and recent changes — all via `servicenow_query_records`.

**5. Multi-instance work.**
Keep dev write-enabled and prod read-only in one YAML. By default the MCP tracks
whichever instance now-sdk is pointed at; set `SERVICENOW_FOLLOW_NOW_SDK=false`
to pin the YAML's own `default` instead.

---

## Safety model

- **Read-only by default.** Every instance is read-only unless you explicitly set
  `readOnly: false`. Write tools return a clear `AccessDeniedError` otherwise.
- **Table allow/deny lists.** `SERVICENOW_BLOCKED_TABLES` / `SERVICENOW_ALLOWED_TABLES`
  gate every table operation (data ops *and* schema discovery) — deny wins, an
  allow-list is exclusive when set, trailing-`*` wildcards supported.
- **Anti-lockout.** A per-instance rate limiter caps concurrency, and a circuit
  breaker stops calling an instance after repeated failures (faster on 401/403)
  to avoid tripping ServiceNow account/ACL lockout — it fails fast instead of
  retrying into a wall.
- **Write audit log.** Every POST/PUT/PATCH/DELETE is recorded (stderr, and to a
  JSON-lines file if `SERVICENOW_AUDIT_LOG` is set), and every tool call logs a
  structured `{tool, durationMs, ok}` line. The file is size-capped and rotated
  to `<path>.1` at 10 MiB (override with `SERVICENOW_AUDIT_LOG_MAX_BYTES`; set to
  `0` to disable rotation).
- **No credential magic.** Credentials live in your YAML / env, never read from
  now-sdk's keychain. Keep config files out of git (the provided `.gitignore`
  already excludes them).

---

## Development

<details>
<summary>Local development (working inside this repo)</summary>

The committed `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}`, so it's meant for the
plugin runtime, **not** for opening the repo directly. To hack on the server in
this checkout, build and register it at user scope pointing at your config:

```bash
git clone <REPO_URL>
cd now-mcp
pnpm install
pnpm build
claude mcp add now-mcp -s user \
  --env SERVICENOW_CONFIG_PATH="$PWD/config/servicenow-instances.yaml" \
  -- node "$PWD/build/index.js"
```

Or run the source directly without building: `pnpm exec tsx src/index.ts`.
</details>