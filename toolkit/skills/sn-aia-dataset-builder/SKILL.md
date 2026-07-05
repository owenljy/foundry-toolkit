---
name: sn-aia-dataset-builder
description: Creates aia_artifact_dataset fluent records (test cases with prompts, context, ground truth) for use in ServiceNow AI agent evaluations. Use when the user wants to define test data, create eval datasets, add test scenarios, or set up ground truth. Trigger on phrases like "create dataset", "test data", "test cases", "ground truth", "eval dataset", "artifact dataset", "test scenarios".
---

# ServiceNow AI Agent Dataset Builder

Creates `aia_artifact_dataset` fluent records — the test cases that power eval runs in the ServiceNow **Now Assist → Evaluations** UI.

Each dataset record represents one test scenario: a prompt sent to the agent, optional context (a real ServiceNow record), and optionally a ground truth expected response used for AI-scored accuracy metrics.

> **Prerequisite — check before proceeding:** This skill generates files that deploy via `now-sdk`. Check `package.json` for `@servicenow/sdk` before generating anything. If it's missing, **tell the user explicitly**: "now-sdk isn't a dependency in this repo — I can draft the dataset files, but they won't deploy until it's installed." Don't discover this only when the deploy step fails.

---

## Scope — Ask This First

**Single scope or two scopes?**

| Mode | Where dataset files go | When to use |
|---|---|---|
| **Single scope** | `src/fluent/agent/ai-agent-<name>/eval/` | Internal tools, prototypes, or when eval data ships with the agent |
| **Two scopes** | `src/fluent/eval/ai-agent-<name>/` | Shipping agents to customers — keeps test data out of the customer-deliverable app |

**Why two scopes prevent customer shipping:** Records are owned by whichever app deployed them, determined by `now.config.json` in each repo. The agent app (`now.config.json` scope = e.g. `sn_obs_aia`) and the eval app (`sn_obs_aia_eval`) are separate packages. When you ship or install the agent app, the eval scope is simply not included — its records stay on internal/dev instances only. `sys_domain: 'global'` on the records does not affect this — domain controls visibility within an instance, not which app package a record belongs to.

Dataset records and eval metric configs are the only files that ever go in the eval scope. The eval runner Script Include (which triggers evals) always stays in the agent scope.

---

## How Datasets Connect to Evaluations

```
aia_artifact_dataset records   ← you define these (this skill)
         ↓
  Dataset Snapshot (UI)         ← created in ServiceNow UI, filters aia_artifact_dataset by criteria
         ↓
    Eval Run (UI)               ← selects agent version + dataset snapshot → scores each record
         ↓
  Eval Results                  ← per-metric scores: faithfulness, correctness, task completeness
```

---

## Step 1: Identify the Agent and Use Case

Ask: **Which agent are these test cases for?** Read its `<name>-instructions.md` to understand the question categories and tools it uses.

Also ask:
- **Does the agent have a use case record (`sn_aia_usecase`)?** If yes, collect its sys_id — it goes in `usecase_table: 'sn_aia_usecase'` + `aia_usecase` on each dataset record.
- **Does the agent need a context record (alert, incident, change) to function?** Many agents are sub-agents that expect upstream context (e.g., an `em_alert` sys_id). If yes, every dataset record must include `artifact_table` and `artifact_record` pointing to a real record on the instance, or the agent's tools will fail at eval time.
- **Does the agent access context directly, or does a parent orchestrator pre-process it?** This is critical for standalone eval wrappers. Check the parent orchestrator's instructions — if a parent tool extracts IDs before calling this agent, the agent has no way to get that data itself. In that case, **embed the pre-processed data directly in the prompt**. The `artifact_table`/`artifact_record` fields won't help if the agent has no tool to read that table.

---

## Step 2: Clarify Development Stage and Metrics Focus

Ask: **What stage of development is this agent at?** This determines dataset size targets and which scenario types to prioritize.

| Stage | Target size | Scenario focus | Key metrics to exercise |
|---|---|---|---|
| Discovery | 100–500 | Core functionality, basic tool use | Task Success, Plan Correctness, Tool Choice/Calling Accuracy, Faithfulness |
| Development | 500+ | All types including edge cases and error scenarios | All inner loop metrics + Trajectory Alignment |
| Testing & Validation | 1000+ | Edge cases, adversarial, robustness | Run-to-Run Variance, Robustness, PCR, Trajectory Alignment |
| Deployment | Continuous | Representative production scenarios | Task Success, PCR, Faithfulness, Completeness |

If unsure, default to **Development** coverage (all scenario types).

---

## Step 3: Plan Test Scenarios

From the agent's instructions, identify the distinct categories it handles. Design test cases across these **four scenario types** using the target ratio: **40% core / 30% edge / 20% error / 10% adversarial** (or 35/25/25/15 for high-risk/regulated agents). Prefer scenarios sourced from real customer data (DART clones) for realism; use synthetic generation (Auto Chat / Data Kit) for edge cases at scale. For the full trajectory-based evaluation pattern, see the eval-metrics doc (`docs/eval-metrics.md`).

| Scenario type | Description | `context_scenario` should mention |
|---|---|---|
| `core_functionality` | Clear, answerable happy-path question | Normal operating conditions |
| `edge_case` | No results, empty state, relative time, ambiguous input | Unusual but valid conditions |
| `error_scenario` | Tool failure, service unavailable, bad parameters | Expected failure modes |
| `adversarial` | Out-of-scope requests, conflicting instructions, injection attempts | Unexpected/hostile inputs |

Present proposed cases to the user before generating files:

```
Proposed test cases for <agent-name>:

1. [core_functionality] unique_id: <agent>-<slug>
   initial_query: "<prompt>"
   end_goal: "<what the agent should accomplish>"
   context_scenario: "<background>"

2. ...
```

Ask: **Does this look right? Any adjustments, additions, or scenarios to remove?**

---

## Step 4: Collect Ground Truth (Optional)

There are two ground truth patterns. Pick based on the scenario:

### Pattern A — Golden Response (only for time-stable queries)

Use for queries whose correct answer does not change over time — e.g., "what fields does this record have?" or "what is the standard resolution for this error type?". Also appropriate for adversarial/refusal scenarios (out-of-scope requests, prompt injection attempts) where the expected response is always the same.

Store in `additional_details`:
```ts
additional_details: `Golden response (grounded <date>):

<expected agent response here>`,
```

**Do NOT use for:** "current active alerts", "open issues right now", "golden signals for X", or any query where the correct answer depends on live system state. These golden responses go stale and will cause false eval failures. Convert these to Pattern B instead.

### Pattern B — Ground Truth Trajectory (preferred for most scenarios)

Define the **reference path** (sequence of tool calls) the agent should follow. The eval measures whether the agent followed the correct steps — not whether the data returned matched a snapshot.

Store in `additional_details` as a JSON array:
```ts
additional_details: `Ground Truth Trajectory:

[
  {
    "step_number": 1,
    "step_description": "Fetch the relevant records to answer the question",
    "tool_name": "<tool-name>",
    "tool_parameters": {
      "<param>": "<value>"
    },
    "expected_tool_response": {
      "records_found": true
    },
    "reasoning": "The agent must retrieve data before it can answer."
  },
  {
    "step_number": 2,
    "step_description": "Synthesize and summarize the findings for the user",
    "tool_name": null,
    "tool_parameters": null,
    "expected_tool_response": {
      "summary_present": true,
      "addresses_question": true
    },
    "reasoning": "Final response must directly answer the user's question."
  }
]`,
```

**Key rules for trajectories:**
- `expected_tool_response` must be **structural** (boolean flags, shape checks) — not specific runtime values like entity names or alert counts
- Use `tool_name: null` for synthesis/presentation steps that involve no tool call
- Tool names MUST match actual `sn_aia_tool` records in the agent's tool files — verify against actual tool files
- Reference specific agent instruction rule numbers in the `reasoning` field so reviewers can trace back to the source

### Pattern A/B vs Platform GT — When to Use What

| Aspect | Pattern A/B (`additional_details`) | Pattern C (`ground_truth` table) |
|---|---|---|
| Metrics enabled | Faithfulness, Correctness, Correctness with Golden Response | Tool calling correctness (GT), Output alignment (GT), Tool choice accuracy (GT) |
| Agentic pipeline support | Not yet (requires `{{generated_response}}` variable) | Yes — works with Auto Chat agentic pipeline |
| What it validates | Response quality and content accuracy | Tool selection, parameter correctness, output values |

Both can coexist on the same `aia_artifact_dataset` record — Pattern A/B in `additional_details`, platform GT linked via `ground_truth` field.

### Pattern C — Platform Ground Truth Record (for GT-specific metrics)

Use when you want to evaluate tool calling correctness, tool choice accuracy, and output alignment — the **"With ground truth"** metrics on the Skill Kit Evaluation Dashboard.

Platform GT records live in the `ground_truth` table with structured JSON. They are **complementary** to Pattern A/B.

**When to use Pattern C:** When the agent's value is in calling the right tools with the right parameters, and you want to score that precisely. Pattern C is the more immediately useful approach since the agentic pipeline doesn't populate the variables needed for Faithfulness/Correctness metrics.

**Critical:** `agent_name` and `tool_name` in the GT JSON must **exactly match** the runtime strings from `sn_aia_execution_task`. A mismatch causes GT metrics to report incorrect tool choices even when the agent behaves correctly.

To verify exact runtime names, query execution tasks on the instance:
```js
var gr = new GlideRecord('sn_aia_execution_task');
gr.addQuery('execution_plan', '<execution_plan_sys_id>');
gr.orderBy('order');
gr.query();
while (gr.next()) {
    gs.info('type=' + gr.getValue('type') +
            ' | target_table=' + gr.getValue('target_document_table') +
            ' | target_id=' + gr.getValue('target_document_id'));
}
```

#### GT JSON Schema

```json
{
  "version_number": "1.0",
  "sysID": "<ground_truth_record_sys_id>",
  "name": "<descriptive name>",
  "groundtruth_type": "agentic_workflow",
  "objective": "<initial_query from the dataset record>",
  "language": "en",
  "executed_tools": [
    {
      "agent_name": "<exact agent name from sn_aia_execution_task>",
      "tool_name": "<exact tool name from sn_aia_execution_task>",
      "tool_id": 1,
      "depends_on": [],
      "input": {
        "<param_name>": {
          "name": "<param_name>",
          "value": "<expected_value>",
          "description": "",
          "mandatory": true,
          "value_match": {
            "type": "exact",
            "score_type": "boolean"
          }
        }
      }
    }
  ],
  "output_evaluations": [
    {
      "metric_label": "<what you're checking>",
      "expected_output": "<expected value or text>",
      "match_skill_id": "<OOB skill sys_id>",
      "additional_parameters": {},
      "score_type": "boolean"
    }
  ]
}
```

**Critical:** `agent_name` and `tool_name` must **exactly match** the strings the platform reports at runtime in `sn_aia_execution_task`. A single character difference causes GT metrics to report tool choices as incorrect even when the agent behaves correctly.

#### OOB Evaluation Skills for `output_evaluations`

| Skill | `match_skill_id` | Purpose |
|---|---|---|
| **Glide Skill** | `dfe17d94ff31b2109903ffffffffffe1` | Verify a value on a GlideRecord field (exact or semantic match) |
| **Output Skill** | `8793305cff3972109903ffffffffff23` | Verify output text from agent execution (exact or semantic match) |

**Glide Skill** — checks a field value on a record the agent acted on:
```json
{
  "metric_label": "Urgency",
  "expected_output": "3 - Low",
  "match_skill_id": "dfe17d94ff31b2109903ffffffffffe1",
  "additional_parameters": {
    "table": "incident",
    "number": {
      "agent_name": "Record field value prediction AI agent",
      "tool_name": "Get the record metadata",
      "field": "number"
    },
    "field_name": "urgency"
  },
  "score_type": "boolean"
}
```

**Output Skill** — checks text output from a specific agent tool call:
```json
{
  "metric_label": "Resolution Plan",
  "expected_output": "1. Escalate the incident...\n2. Provide all relevant details...",
  "match_skill_id": "8793305cff3972109903ffffffffff23",
  "additional_parameters": {
    "execution_output": {
      "agent_name": "ITSM incident resolution plan investigation AI agent",
      "tool_name": "Add a resolution plan or failure message to incident's work notes",
      "field": "plan_to_add_array"
    },
    "match_type": "semantic"
  },
  "score_type": "boolean"
}
```

#### How to Get Exact Names

Run the agent once and check the execution trace:
```js
var gr = new GlideRecord('sn_aia_execution_task');
gr.addQuery('execution_plan', '<execution_plan_sys_id>');
gr.orderBy('order');
gr.query();
while (gr.next()) {
    gs.info('type=' + gr.getValue('type') +
            ' | target_table=' + gr.getValue('target_document_table') +
            ' | target_id=' + gr.getValue('target_document_id'));
}
```

#### Generating Platform GT from Executions

**Recommended workflow:** Extract GT from a successful execution, then curate:

1. Run the agent on a test case (via Agentic Studio or background script)
2. Extract GT:
```js
// Run in Scripts > Background
var encodedQuery = "sys_id=<execution_plan_sys_id>";
var tag = "my-agent-gt";
new sn_prompt_assist.AutoEvalGTUtil().extractGroundTruth(encodedQuery, tag);
```
3. Open each `ground_truth` record → click **Edit Ground Truth JSON** (requires GT JSON editor update set `sys_id: f2a4521b979bb6100e9570700153afcc`)
4. Verify `executed_tools` — check agent names, tool names, input parameters
5. Add `output_evaluations` — define what output values to check
6. Set `value_match.type` to `"exact"` or `"semantic"` as appropriate

### Linking a ground truth record

```ts
ground_truth: '<ground-truth-record-sys-id>',
```

Ground truth records are created either via `AutoEvalGTUtil().extractGroundTruth()` from executions (recommended) or manually in ServiceNow UI at **Now Assist → Evaluations → Ground Truth → New**. If the sys_id isn't available yet, omit the field and note it can be added after deploying.

### Fluent ground_truth record template

When creating platform GT records as fluent files alongside dataset records:

```ts
import { Record } from '@servicenow/sdk/core';

const gt = Record({
    $id: Now.ID['gt-<agent>-<scenario-slug>'],
    table: 'ground_truth',
    data: {
        ground_truth: JSON.stringify({
            version_number: '1.0',
            sysID: '<use the UUID from keys.ts for this record>',
            name: '<Agent Name> - <Scenario>',
            groundtruth_type: 'agentic_workflow',
            objective: '<initial_query from the dataset record>',
            language: 'en',
            executed_tools: [
                {
                    agent_name: '<exact runtime agent name>',
                    tool_name: '<exact runtime tool name>',
                    tool_id: 1,
                    depends_on: [],
                    input: {},
                },
            ],
            output_evaluations: [],
        }),
        sys_domain: 'global',
    },
});

export { gt };
```

Then in the dataset record file, link it:
```ts
        ground_truth: gt.$id,
```

> **Important:** The `sysID` inside the JSON should match the record's own sys_id (the UUID from `keys.ts`). Register both the `gt-*` key (table `ground_truth`) and the dataset key in `keys.ts`.

---

## Step 5: Generate Dataset Files

Generate one `.now.ts` file per test case. Place them based on scope:
- **Single scope:** `src/fluent/agent/ai-agent-<name>/eval/`
- **Two scopes:** `src/fluent/eval/ai-agent-<name>/`

### File template

**`<scope-path>/<name>-dataset-<scenario>.now.ts`**:

```ts
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['<agent>-<scenario-slug>'],
    table: 'aia_artifact_dataset',
    data: {
        unique_id: '<agent>-<scenario-slug>',
        initial_query: '<the user prompt to send to the agent>',
        end_goal: '<what the agent should accomplish>',
        context_scenario: '<optional: background context for the evaluator>',
        sys_domain: 'global',
    },
})
```

### With a specific ServiceNow record as context

Use `artifact_table` + `artifact_record` when the agent needs to act on a real record (e.g. an incident, alert, or change):

```ts
        artifact_table: '<table-name>',      // e.g. 'incident', 'em_alert', 'change_request'
        artifact_record: '<record-sys-id>',  // sys_id of the record to use as context
```

### With additional context fields

```ts
        additional_details: '<extra context the evaluator needs to judge the response>',
        business_knowledge: '<business domain context, e.g. what this service does>',
        external_knowledge: '<external references, docs, or links relevant to this scenario>',
```

### With a use case reference

```ts
        usecase_table: 'sn_aia_usecase',
        aia_usecase: '<usecase-sys-id>',
```

### With ground truth (if sys_id already known)

```ts
        ground_truth: '<ground-truth-record-sys-id>',
```

### With run_as_user

If the eval should simulate a specific user's context (e.g. to test role-based access behavior):

```ts
        run_as_user: '<user-sys-id>',
```

---

## Step 6: Generate a Dataset Index File *(optional)*

If there are multiple test cases, generate a single index file that documents the full dataset for easy reference:

**`src/fluent/agent/ai-agent-<name>/eval/<name>-dataset-index.md`**:

```markdown
# <Agent Name> Eval Dataset

| unique_id | Category | initial_query (excerpt) | has ground truth | artifact_record |
|---|---|---|---|---|
| <agent>-<slug-1> | <category> | <first 60 chars of prompt> | no | — |
| <agent>-<slug-2> | <category> | <first 60 chars of prompt> | yes | <table>:<sys-id> |
```

---

## Step 7: Connect to Evaluations

After deploying the fluent files, use the **Set up automated evaluation** wizard in ServiceNow:

```
Now Assist → Evaluations → New → Set up automated evaluation
```

### Prerequisites
The agent must have an `sn_aia_version` with `state: 'published'`. Run `/sn-eval-runner-builder` (Phase 0.1) if not.

### Step 3 of the wizard — Choose or create a dataset

**To use the `aia_artifact_dataset` records you just deployed:**
- Select "Create a dataset" → "By running the AI agent and using the generated execution logs"
- Table: `aia_artifact_dataset`
- Filters: `unique_id | starts with | <agent>-`
- Maximum records: set to the number of test cases
- The system runs the agent on each record; the execution logs become the dataset snapshot

**To reuse a previously created dataset (e.g. from a prior eval run):**
- Select "Choose from existing datasets" → pick the named snapshot

> **Important:** Run in a demo or sub-production environment. When the AI agent is triggered on real records, it may change their state in the instance.

---

## Field Reference

| Field | Type | Max | Required | Notes |
|---|---|---|---|---|
| `unique_id` | string | 80 | Yes | Slug identifier, e.g. `new-relic-mcp-entity-impact-1` |
| `initial_query` | string | 800 | Yes | The prompt sent to the agent |
| `end_goal` | string | 800 | Yes | What the agent should accomplish |
| `context_scenario` | string | 4000 | No | Background context for the evaluator |
| `additional_details` | string | 4000 | No | Extra evaluator context |
| `business_knowledge` | string | 1000 | No | Business domain knowledge |
| `external_knowledge` | string | 1000 | No | External references |
| `artifact_table` | table_name | — | No | Table of the context record |
| `artifact_record` | document_id | — | No | sys_id of the context record |
| `usecase_table` | table_name | — | No | Usually `sn_aia_usecase` |
| `aia_usecase` | document_id | — | No | sys_id of the use case |
| `ground_truth` | reference | — | No | sys_id of a `ground_truth` record |
| `run_as_user` | reference | — | No | sys_id of user to simulate |

---

## Refreshing Golden Responses

Golden responses (Pattern C, and any `expected_*` fields with literal values) are point-in-time snapshots. They go stale whenever the underlying source — live MCP server, external API, or backing data — changes. Stale goldens cause false eval failures that look like agent regressions.

**When to refresh:**

- Source system schema or response shape changed
- Eval failures cluster under the **Data Quality** pattern (see `/sn-eval-runner-builder` taxonomy)
- It's been long enough that the underlying data has measurably moved on (typical cadence: every release, or when adding new metrics)

**Refresh workflow** (works for any agent that calls live external systems):

1. Open the eval repo in Claude Code with the relevant MCP server / API connection authenticated
2. Ask: *"Re-run all the `<agent>` eval questions against the live source and update the dataset files with current responses"* — Claude will iterate over each `aia_artifact_dataset.now.ts` file, call the source for each prompt, and patch the golden field
3. Diff the result; sanity-check that the changes are real source drift, not agent regressions
4. `pnpm run build:install` to redeploy the updated dataset records
5. Re-run the eval and compare scores against the previous run

> Pattern A (structural / boolean assertions) and Pattern B (`additional_details` rubrics) don't need refreshing — that's their main advantage over literal golden responses for queries about live state.

---

## After Generating

Tell the user:
- How many dataset files were created and their paths
- The `unique_id` prefix pattern (e.g. `<agent-prefix>-`) to use when filtering in the UI
- If any test cases are missing `ground_truth`, note they can add it after deploying by editing the record in the UI and referencing a newly created ground truth record
- That the dataset snapshot must be created in the ServiceNow UI after deployment
- Offer to also run `/sn-eval-runner-builder` (Phase 0.1) if the agent's version file isn't published yet
