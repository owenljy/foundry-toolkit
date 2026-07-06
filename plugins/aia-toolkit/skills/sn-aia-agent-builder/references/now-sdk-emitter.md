# now-sdk emitter — Design Spec → typed Fluent API

> **Always run `now-sdk explain aiagent-api` (and `aiagenticworkflow-api`) before
> emitting** — that output is the live param surface for the installed SDK version.
> This file shows structural patterns and rules; `now-sdk explain` wins on specific
> param names, required fields, and enum values. now-sdk owns the table
> relationships, columns, defaults, and ACL/role plumbing — this skill does **not**
> re-encode them.

This is the "emitter": it maps the reviewed **Agent Design Spec**
(`references/agent-design-spec.md`) onto now-sdk's typed constructs. It replaces
the old hand-rolled `Record({ table: 'sn_aia_*', data: {...} })` templates.

## Why typed API, not `Record()`

`AiAgent()` auto-generates ~9 records (`sn_aia_agent`, `sn_aia_agent_config`,
`sn_aia_version`, `sn_aia_tool`, `sn_aia_agent_tool_m2m`, `sys_security_acl` +
roles, trigger config) **with correct relationships, defaults, and types**.
`AiAgenticWorkflow()` auto-generates ~7 (`sn_aia_usecase`, `sn_aia_team`,
`sn_aia_team_member`, `sn_aia_version`, trigger, role config).

Hand-writing those with `Record()` means: re-encoding column names, string-
boolean quirks, and — worst — **hardcoded sys_ids** (e.g. the old
`strategy: 'b264c47…'`) that silently break across instances/releases with **no
type checking**. The typed API gives you `tsc` safety and version-correctness for
free. So:

- **Rule E1 — Prefer the typed API.** Emit `AiAgent()` / `AiAgenticWorkflow()` /
  `Acl()` / `Alias()`. Use `Record({ table: 'sn_aia_*' })` **only** for a
  genuine gap the typed API doesn't cover (see "Gap policy"), clearly commented.
- **Rule E2 — Reference by name, never by sys_id.** Roles via `dataAccess.roleMap`
  (names). Cross-refs via the JS variable where the type allows it. A 32-char hex
  literal in any `sn_aia_*` / agent file is a bug — the audit scan flags it.
  **Carve-out:** `team.members` does NOT accept `AiAgent()` return values
  (`AiAgentType` is not assignable to `string | Record<'sn_aia_agent'>`); use
  `Now.ref('sn_aia_agent', '<key>')` with the same key string as the agent's `$id`.
- **Rule E3 — Don't set what the plugin defaults.** Omit `active`, `sysDomain`,
  `executionMode`, `recordType` etc. unless the Spec differs from the default.

## Single agent → `AiAgent()`

One file: `src/fluent/agent/ai-agent-<name>/<agent>-agent.now.ts`.

```ts
import { AiAgent } from '@servicenow/sdk/core'

export const agent = AiAgent({
  $id: Now.ID['<agent-name>'],
  name: '<Agent Name>',
  description: '<one-sentence description>',
  agentRole: '<persona: "You are an expert <domain> agent specializing in …">',

  recordType: 'custom',          // user-created agents
  channel: 'nap_and_va',         // 'nap' | 'nap_and_va'
  // active defaults true; omit unless Spec says inactive-on-deploy:
  // active: false,

  // Instructions live in their own .md (skill-owned authoring — see SKILL.md):
  versionDetails: [
    {
      name: 'V1',
      number: 1,
      state: 'published',
      instructions: Now.include('./<agent>-instructions.md'),
    },
  ],

  // Who can INVOKE the agent (auto-creates sys_security_acl + roles):
  securityAcl: { $id: Now.ID['<agent-name>-acl'], type: 'Any authenticated user' },
  //   type: 'Specific role'  → add  roles: ['itil', …]   (names ok)
  //   type: 'Public'         → no auth

  // Identity the agent RUNS AS. Dynamic user → dataAccess by ROLE NAME:
  dataAccess: { roleMap: ['itil'], description: 'Role-based access' },
  //   AI/service user instead → runAsUser: '<sys_user reference>' and omit dataAccess.

  // Optional agent scripts (Rhino IIFE source — see Runtime Contract in SKILL.md):
  // contextProcessingScript: Now.include('../../../server/agents/<agent>/agent-scripts/<agent>-context-processing.js'),

  tools: [ /* see Tool types below */ ],

  // Optional triggers (replaces the old 5-record hand-rolled trigger set):
  // triggerConfig: [ … see Triggers below ],
})
```

### Tool types (the `tools[]` discriminated union)

`type` selects required fields. Apply the **selection priority** from SKILL.md
(OOB → reference-based → crud → script). Per-tool execution fields:
`executionMode` (`'autopilot'` default; `'copilot'` only for state-mutating),
`displayOutput`, `outputTransformationStrategy`, `maxAutoExecutions`,
`preMessage`/`postMessage`.

| `type` | Required field | Notes |
|---|---|---|
| `web_automation` / `knowledge_graph` / `file_upload` / `deep_research` / `desktop_automation` | — | OOB tools, prefer these |
| `search_retrieval` | `inputs: RagInputType` | RAG (semantic/keyword/hybrid) |
| `capability` | `capabilityId` | **Now Assist skill** (Skill Kit) as a tool |
| `subflow` | `subflowId` | Flow Designer subflow |
| `action` | `flowActionId` | Flow Designer action |
| `catalog` | `catalogItemId` | Service Catalog item |
| `topic` / `topic_block` | `virtualAgentId` | Virtual Agent |
| `mcp` | — | MCP tool (see SKILL.md Step: MCP) |
| `crud` | `inputs: ToolInputType` | **Script auto-generated by now-sdk** — do NOT hand-write GlideRecord |
| `script` | `script` | Custom Rhino script — **the one place the skill still owns `.js`** |

```ts
// crud — now-sdk generates the GlideRecord script from inputs.
// operationName ∈ { lookup, create, update, delete }.
// For lookup/update, use queryCondition (alias: query) with {{inputFieldName}} placeholders
// that reference inputFields[].name:
{ name: 'Get RFP', description: '…', type: 'crud', executionMode: 'autopilot',
  inputs: { operationName: 'lookup', table: 'x_app_rfp',
    queryCondition: 'number={{rfp_number}}',
    inputFields: [{ name: 'rfp_number', mappedToColumn: 'number', type: 'string', mandatory: true }],
    returnFields: [{ name: 'sys_id' }, { name: 'number' }, { name: 'short_description' }] } }

{ name: 'Save Article', description: '…', type: 'crud', executionMode: 'autopilot',
  inputs: { operationName: 'create', table: 'x_app_articles',
    inputFields: [{ name: 'title', mappedToColumn: 'title', type: 'string', mandatory: true }],
    returnFields: [{ name: 'sys_id' }, { name: 'number' }] } }

// script — author the plain-JS IIFE per the Runtime Contract; reference it here:
{ name: 'Get Metrics', description: '…', type: 'script', executionMode: 'autopilot',
  script: Now.include('../../../server/agents/<agent>/tool-scripts/get-metrics.js'),
  inputs: [{ name: 'connectionSysId', description: '…', mandatory: true, value: '', invalidMessage: null }] }
```

> **Tool names are project-global.** now-sdk derives each `sn_aia_tool` record's
> sys_id from the tool `name`, so two agents that both declare a tool named
> `get_rfp` collide at build time: "Record sn_aia_tool.\<id\> is defined 2 times".
> The typed API does NOT share or dedupe same-named tools across agents. Keep every
> tool `name` unique within the project — prefix per agent, e.g. `get_rfp_for_eval`.

> **Journal fields** (`work_notes`, `comments`, `activity_stream`): still use a
> `script` tool with `GlideRecordSecure`, never `crud`. now-sdk's crud generator
> is for ordinary columns.
>
> For the exact `RagInputType` / `ToolInputType` / `ToolInputField` shapes, run
> `now-sdk explain aiagent-api` — do not copy a stale shape into this file.

### Triggers (`triggerConfig[]`)

Replaces the old 5-record trigger set. `triggerFlowDefinitionType`:
`record_create` | `record_create_or_update` | `record_update` | `email` |
`scheduled` | `daily` | `weekly` | `monthly`.

```ts
triggerConfig: [{
  name: 'High Priority Trigger', channel: 'Now Assist Panel',
  objectiveTemplate: 'Handle topic: ${topic_name}',
  targetTable: 'x_app_topics', triggerFlowDefinitionType: 'record_create_or_update',
  triggerCondition: 'active=true^priority=high', active: true,
}]
```

> **Trigger + run-as:** a triggered (async) agent must run as a real user, not a
> dynamic user. Set `runAsUser`. The post-deploy `sys_security_acl` created via a
> `security_admin` Background Script is still required and is **not** SDK-written
> — that gotcha and its verification script remain in `docs/trigger-mode-setup.md`.

## Multi-agent workflow → `AiAgenticWorkflow()`

One file: `src/fluent/agent/ai-agent-<name>/<workflow>-workflow.now.ts`. Covers
usecase + team + team_member + version. **No hardcoded strategy sys_id** —
`executionMode` is a typed enum.

```ts
import { AiAgenticWorkflow } from '@servicenow/sdk/core'
import { triageAgent } from '../ai-agent-triage/triage-agent.now'
import { resolveAgent } from '../ai-agent-resolve/resolve-agent.now'

export const workflow = AiAgenticWorkflow({
  $id: Now.ID['<workflow-name>'],
  name: '<Workflow Name>',
  description: '<what this workflow orchestrates>',
  securityAcl: { $id: Now.ID['<workflow-name>-acl'], type: 'Any authenticated user' },
  // executionMode defaults 'copilot'; set 'autopilot' to run the plan autonomously:
  executionMode: 'autopilot',
  team: {
    $id: Now.ID['<team-name>'],
    name: '<Team Name>',
    // AiAgent() returns AiAgentType, NOT assignable to team.members typed as
    // (string | Record<'sn_aia_agent'>)[]. Use Now.ref() with the same key as each agent's $id:
    members: [
      Now.ref('sn_aia_agent', '<triage-agent-key>'),
      Now.ref('sn_aia_agent', '<resolve-agent-key>'),
    ],
  },
  dataAccess: { roleMap: ['itil'] },        // or runAs: '<field>' for dynamic identity
  versions: [{ name: 'V1', number: 1, state: 'published' }],
})
```

> To add an agent to an **existing** workflow, reference its team via the team's
> Record/variable; do not paste a sys_id.

## Gap policy (when `Record()` is still allowed)

Default: there is **no gap** for core agent/workflow structure — `AiAgent()` and
`AiAgenticWorkflow()` cover it. Before hand-rolling a `Record({ table: 'sn_aia_*' })`:

1. Confirm with `now-sdk explain aiagent-api` / `aiagenticworkflow-api` that no
   typed param exists.
2. If genuinely missing, emit the `Record()` in **one clearly-commented place**
   and add it to the **gap list** at the bottom of this file with the date and SDK
   version, so it's re-checked each release.

**Known gaps:** _(none currently — review per release.)_

## Connection aliases & ACLs

- HTTP connection alias → now-sdk **`Alias()` / alias templates** (`now-sdk explain
  alias-api`, `aliastemplate-api`, `alias-guide`). Do not hand-roll `sys_alias` /
  `sys_alias_templates` with `Record()`. After deploy, finish the connection at
  `sys_alias.list` → **Create New Connection & Credential** (a UI step, not code).
- Reading credentials **inside a Rhino tool script** at runtime (vendor
  `getAttribute` keys, Basic/OAuth/SigV4 flows) is a separate concern from
  creating the alias — see [credential-auth.md](credential-auth.md).
- Standalone ACLs → `Acl()` (`now-sdk explain acl-api`). For agent-invocation
  access, prefer the `securityAcl` param on `AiAgent()` (it builds the ACL for you).

## Per-tool execution fields

Each `tools[]` entry carries these execution fields — judgment, not plumbing:

| Field | Default | Override when |
|---|---|---|
| `executionMode` | `autopilot` | tool **mutates state** (transfer, payment, delete) → `copilot` |
| `displayOutput` | `false` | the raw return is itself the user-facing display (rare) |
| `outputTransformationStrategy` | `none` | long unstructured text → `summary`; search hit lists → `summary_for_search_results`. Never for structured JSON (collapses to `"success"`). |
| `maxAutoExecutions` | `10` | lower for expensive tools |

## Directory structure

The full layout the builder emits (Step 3):

```
src/fluent/agent/ai-agent-<agent>/
  <agent>-agent.now.ts            # AiAgent({...}) — agent + tools[] + acl + triggers
  <agent>-instructions.md         # Now.include'd by versionDetails
  <agent>-proficiency.md
  <workflow>-workflow.now.ts      # AiAgenticWorkflow({...}) — only for multi-agent
src/server/agents/<agent>/agent-scripts/
  <agent>-applicability.js        # plain-JS IIFE (Runtime Contract)
  <agent>-context-processing.js
src/server/agents/<agent>/tool-scripts/
  <tool-name>.js                  # one per SCRIPT-typed tool (crud is auto-generated)
```

That's it — the per-table `Record()` sprawl (config/version/tool/m2m/team/
team-member/mcp-server/security-acl) is gone; `AiAgent()`/`AiAgenticWorkflow()`
generate those records.
