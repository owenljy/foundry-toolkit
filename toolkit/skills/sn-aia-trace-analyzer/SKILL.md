---
name: sn-aia-trace-analyzer
description: Analyzes AI Agent execution traces, spans, and logs on a ServiceNow instance to diagnose runtime failures, wrong answers, slow runs, stuck executions, and "phantom success" (a tool reports success but returned empty/undefined output). Walks the execution plan → tasks → tool calls → LLM logs → performance events chain. Includes GAIC error code interpretation, Rhino tool-script error-signature detection, performance metrics computation, and structured diagnostic checklists. Can also trigger a test run to populate tracing tables. Use after an agent is deployed and running. Trigger on phrases like "trace analysis", "analyze agent run", "why did the agent fail", "agent gave wrong answer", "agent returned empty/blank/placeholder data", "tool succeeded but no data", "agent is slow", "debug agent run", "execution trace", "inspect spans", "root cause analysis", "agent runtime issue", "what went wrong", "analyze execution plan", "GAIC error", "error code", "LLM error".
argument-hint: "[execution-plan-sys-id] [symptom / what went wrong]"
context: fork
agent: general-purpose
effort: high
---

# ServiceNow AI Agent Trace Analyzer

Diagnoses runtime issues with deployed AI Agents by walking the execution trace — the layered trail of records the platform writes for every agent run. This is the skill to use when the agent is deployed and running but producing wrong answers, failing, running slow, or behaving unexpectedly.

> **This skill runs in an isolated subagent (`context: fork`) — it has no access to the conversation that invoked it.** Whatever prompted this analysis (an execution plan sys_id, the agent's name, what the user said was wrong) only reaches this skill through `$ARGUMENTS`. If invoked by Claude rather than the user directly, the invoking turn must summarize the relevant context into the args string.

**Given context:** $ARGUMENTS

> **Not for eval infrastructure issues.** If your problem is "eval run produced null results" or "Auto Chat didn't start," use `/sn-eval-runner-builder` instead. This skill is for "the agent ran but did something wrong."

> **Prerequisite:** The agent must have been invoked at least once so tracing records exist. If no execution plan exists yet, this skill can trigger a test run first (Phase 1). This skill reads via the `read_records` capability, resolved against whatever MCP is connected (see [../docs/mcp-capability-resolution.md](../docs/mcp-capability-resolution.md)); if nothing matches, **tell the user explicitly** before falling back to the background scripts in [references/background-scripts.md](references/background-scripts.md).

---

## How a Run is Traced

When an AI Agent runs, the platform writes a layered trail — all joined by **Execution Plan sys_id**:

```
Execution Plan (sn_aia_execution_plan)          ← the run itself
  └─ Execution Tasks (sn_aia_execution_task)    ← every step (think, tool, ask, delegate)
       ├─ Tool Executions (sn_aia_tools_execution)  ← raw request/response per tool call
       ├─ LLM Logs (sys_generative_ai_log)          ← actual prompt + model response + GAIC error codes
       └─ Performance Events (sn_aia_perf_event)    ← timing spans
  └─ Messages (sn_aia_message)                  ← per-plan message view
  └─ Syslog (syslog)                            ← platform errors, stamped with plan ID
  └─ Feedback (sn_aia_execution_feedback)       ← user thumbs/rating
```

**The trick: get the Execution Plan sys_id, then pivot everywhere.**

---

## Phase 1: Get an Execution Plan to Analyze

Ask: **Do you already have an execution plan sys_id, or do you need to trigger a test run?**

### Option A: User provides an execution plan sys_id

Proceed directly to Phase 2.

### Option B: Find a recent execution plan

#### Resolve `read_records`:

> **Every query block in this skill** shows the illustrative param shape
> (`tableName` string, `query` encoded string, `fields` **array** of strings,
> `limit`) from the `servicenow` MCP's `servicenow_query_records` tool.
> Resolve `read_records` per
> [`../docs/mcp-capability-resolution.md`](../docs/mcp-capability-resolution.md)
> against whatever MCP is actually connected, and adapt these param names to
> its real schema. Field names below are the **real `sn_aia_*` DB columns** —
> verified against the live instance via `now-sdk query` and re-checkable with
> `now-sdk explain aiagent-api`. Watch the traps: `sn_aia_tools_execution` keys
> off **`execution_plan_id`** + **`execution_status`** (not
> `execution_plan`/`status`); `sn_aia_execution_task` identifies its target via
> **`target_document_table`/`target_document_id`** (there is no
> `agent_name`/`tool_name` column). For a reference field's human label (e.g.
> `definition` on `sys_generative_ai_log`), look for a display-value
> equivalent on whichever tool resolves — there is no `<field>_dv`
> pseudo-column.

```
servicenow_query_records
  tableName: sn_aia_execution_plan
  query: objectiveLIKE<keyword>^ORDERBYDESCsys_created_on
  fields: ["sys_id","objective","state","state_reason","run_type","execution_time_ms","start_time","end_time"]
  limit: 10
```

Present the results and ask the user to pick one.

#### No match found:

Give the user the recent-plans script from [`references/background-scripts.md`](references/background-scripts.md#option-b--find-a-recent-execution-plan).

### Option C: Trigger a new test run

Ask for:
- **Usecase sys_id** — from `sn_aia_usecase.list`
- **Objective** — the prompt/goal for the agent
- **Target record** (optional) — table + sys_id if the agent needs context

#### Either way:

Use the launch-and-poll script from [`references/background-scripts.md`](references/background-scripts.md#option-c--trigger-a-new-test-run) — resolve `run_privileged_script` and execute it if a matching tool is connected, otherwise give it to the user to run in **Scripts > Background** (Global scope) and ask them to paste back the execution plan sys_id.

> **Prerequisites for triggering a run:**
> - `sn_aia` (nowassist-ai-agents) >= 7.1.8
> - Agent usecase deployed and active
> - LLM connection configured and active
> - AIS status Green/ACTIVE (check `<instance>/xmlstats.do?include=ais`)

---

## Phase 2: Trace Analysis

Once you have the execution plan sys_id, run these checks. Resolve `read_records` and use it, otherwise provide background scripts.

> **On `GlideRecord` vs `GlideRecordSecure`:** the background scripts below are **read-only diagnostics** run interactively by an admin in Scripts > Background — they intentionally use plain `GlideRecord` to see all trace records regardless of ACLs. This is the opposite of the tool-script rule (`CLAUDE.md` mandates `GlideRecordSecure` for deployed tool scripts because those run as the agent's user). Do not "fix" these diagnostic scripts to `GlideRecordSecure` — that would hide records you need to see.

### Step 1: Execution Plan Overview

**What to check:** State, state_reason, timing, run_type, platform-computed latency metrics.

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sn_aia_execution_plan
  query: sys_id=<plan_sys_id>
  fields: ["sys_id","objective","state","state_reason","run_type","execution_time_ms","start_time","end_time","gen_ai_usage_log","llm_p95_latency","tool_p95_latency","llm_token_avg"]
  limit: 1
```

#### No match found — see [`references/background-scripts.md#step-1`](references/background-scripts.md#step-1--execution-plan-overview)

**Interpret the state:**

| State | Meaning |
|---|---|
| `completed` | Normal finish — check if the *output* was correct |
| `terminated` | Abnormal end — check `state_reason` below |
| `in_progress` | Still running or stuck |
| `gatherData` | Waiting for user input — won't complete without interaction |

**Interpret state_reason (for terminated runs):**

| `state_reason` | Meaning | Next step |
|---|---|---|
| `no_activity` | Timeout — nothing happened for too long | Check last execution task |
| `execution_failed` | A tool or step threw an error | Check tool executions |
| `planning_failed` | LLM couldn't produce a usable plan | Check LLM logs |
| `user_exited` | User left the conversation (not a bug) | No action needed |
| `live_agent_requested` | Handed off to a human | Check if this was intentional |
| `fallback_redirected` | Routed elsewhere by fallback config | Check fallback configuration |
| `security_violation` | ACL / permission failure | Check access verification task |

---

### Step 2: Walk the Execution Task Tree

**What to check:** Every step the agent took, in order. Find the first error or the last task (where it got stuck).

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sn_aia_execution_task
  query: execution_plan=<plan_sys_id>^ORDERBYorder
  fields: ["sys_id","type","description","status","order","output","metadata","target_document_table","target_document_id","parent"]
  limit: 50
```

#### No match found — see [`references/background-scripts.md#step-2`](references/background-scripts.md#step-2--walk-the-execution-task-tree)

**Execution task types:**

| `type` | What it represents | What to look for |
|---|---|---|
| `access_verification` | Initial ACL gate | If status=error, user/agent lacks permission |
| `agent` | Agent reasoning loop | Parent container for gen_ai + tool tasks |
| `gen_ai` | One LLM call (the "think" step) | Check Output for the agent's reasoning |
| `tool` | A tool invocation | Cross-reference Tool Execution record |
| `communicator` | Agent asking the user a question | Check if this was expected |
| `manager` | Plan-management housekeeping | Usually not the problem |

**Execution task status indicators:**

| Status | Severity | Meaning |
|---|---|---|
| `completed` | OK | Task finished normally |
| `error` | ERROR | Task failed — this is where things went wrong |
| `cancelled` | ERROR | Task was cancelled |
| `queued` | WARNING | Task is waiting to run |
| `ready` | WARNING | Task is ready but hasn't started |
| `ongoing` | WARNING | Task is still running |

**Reading the trace:**
1. Sort by `order` — read top-to-bottom
2. The first task with `status = error` is where things went wrong
3. If no error but the run is stuck, the *last* task shows where it stopped
4. For `gen_ai` tasks, the `output` field contains the LLM's structured reasoning (JSON nested in JSON — may need pretty-printing)
5. Check `parent` field to understand task nesting — `gen_ai` tasks are children of `agent` tasks
6. Count `gen_ai` tasks to determine **ReAct iterations** — each one is a reason-act loop

---

### Step 3: Inspect Tool Executions

**What to check:** Raw request/response for every tool call. This is where you see exactly what was sent to and returned from flows, scripts, and capabilities.

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sn_aia_tools_execution
  query: execution_plan_id=<plan_sys_id>
  fields: ["sys_id","request","response","execution_status","error_message","execution_time_ms","execution_mode","run_as_user","tool"]
  limit: 20
```

#### No match found — see [`references/background-scripts.md#step-3`](references/background-scripts.md#step-3--inspect-tool-executions)

**What to look for:**
- `execution_status` — did the tool succeed or fail?
- `error_message` — the actual error text
- `request` — were the right parameters sent?
- `response` — did the tool return what the agent expected?
- **PHANTOM SUCCESS** — `execution_status = completed` but `response` is empty, `null`, `undefined`, `{}`, or the literal string `"undefined"`. The tool "succeeded" but returned no data, so the LLM downstream fabricates or emits placeholders. **This is the runtime signature of a script-tool that doesn't return a value on every path** — most often a tool authored with module syntax (`export function …`) or a compiled `dist/` bundle instead of a plain-JS IIFE. See the Runtime Contract in `/sn-aia-agent-builder` (and the `CLAUDE.md` "PLAIN-JS IIFE" blocker). The fix is in the tool script, not the agent.
- `execution_time_ms` — is this tool slow?
- `execution_mode` — `sync` vs `async` (async tools may have different timing characteristics)

**Tool execution status indicators:**

| Status | Severity | Meaning |
|---|---|---|
| `completed` | OK | Tool finished normally |
| `error` | ERROR | Tool failed |
| `timeout` | ERROR | Tool timed out |
| `cancelled` | ERROR | Tool was cancelled |
| `processing` | WARNING | Tool is still running |

---

### Step 4: Inspect LLM Logs (with GAIC Error Code Interpretation)

**What to check:** The actual prompt sent to the model, the model's response, error codes, token usage, and timing. This is the single most important table when the agent says something weird.

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sys_generative_ai_log
  query: sys_created_onBETWEEN<start_time>@<end_time>
  fields: ["sys_id","definition","prompt","response","error","error_code","time_taken","prompt_token_count","response_token_count","prompt_config_id","skill_config_id","output_metadata","started_at","completed_at"]
  limit: 20
```

> **Note:** `sys_generative_ai_log` doesn't have a direct `execution_plan` foreign key. Filter by the time window of the execution plan (start_time to end_time) to find matching LLM calls. If the instance runs multiple agents concurrently, also filter by `conversation` if available.

#### No match found — see [`references/background-scripts.md#step-4`](references/background-scripts.md#step-4--inspect-llm-logs)

**What to look for in the `prompt` field:**
- **`{{variable_name}}` literally in the text** — a variable failed to resolve
- **Empty tool list** at the bottom of the prompt — agent has no tools wired up
- **Missing system instructions** — the agent's role/instructions weren't injected
- **Truncated conversation history** — context window exceeded, earlier turns dropped

**What to look for in the `response` field:**
- **Hallucinated tool names** — agent tried to call a tool that doesn't exist
- **Wrong action format** — agent produced malformed JSON the orchestrator can't parse
- **Refusal** — model refused to answer (safety filter)
- **Empty response** — model returned nothing (check error_code)

#### GAIC Error Code Reference

When `error_code` is present in `sys_generative_ai_log`, look it up in [`references/gaic-error-codes.md`](references/gaic-error-codes.md) — covers pre-processing (100xxx), LLM request (200xxx), post-processing (300xxx), and pipeline (400xxx) codes with workarounds.

---

### Step 5: Check AIA Messages

**What to check:** Messages exchanged during the execution plan — user inputs, agent responses, history context, and user profile data.

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sn_aia_message
  query: execution_plan.sys_id=<plan_sys_id>
  fields: ["sys_id","name","role","message","sys_created_on"]
  limit: 30
```

#### No match found — see [`references/background-scripts.md#step-5`](references/background-scripts.md#step-5--check-aia-messages)

**Message roles:**

| Role | Meaning |
|---|---|
| `user` | User input message |
| `agent` | Agent response |
| `history` | Conversation history context |
| `user_profile` | User profile data injected as context |

**What to look for:**
- Are user messages being captured correctly?
- Is the agent's response matching what the user saw?
- Is conversation history growing too large (context window pressure)?
- Is user profile data being injected when expected?

---

### Step 6: Check Platform Errors (Syslog)

**What to check:** Platform-level errors stamped with the execution plan ID.

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: syslog
  query: sourceLIKEsn_aia^messageLIKE<plan_sys_id>^level=0
  fields: ["sys_id","level","source","message","sys_created_on"]
  limit: 20
```

Also check broader AIA errors in the time window:
```
servicenow_query_records
  tableName: syslog
  query: sourceSTARTSWITHsn_aia^level=0^sys_created_onBETWEEN<start_time>@<end_time>
  fields: ["sys_id","level","source","message","sys_created_on"]
  limit: 20
```

#### No match found — see [`references/background-scripts.md#step-6`](references/background-scripts.md#step-6--check-platform-errors-syslog)

---

### Step 7: Performance Analysis

**What to check:** Timing spans for every LLM call, tool execution, script execution, and user wait.

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sn_aia_perf_event
  query: execution_plan=<plan_sys_id>^ORDERBYDESCduration_ms
  fields: ["sys_id","event_category","duration_ms","sequence","description"]
  limit: 20
```

#### No match found — see [`references/background-scripts.md#step-7`](references/background-scripts.md#step-7--performance-analysis)

**Performance event categories:**

| Category | What it times |
|---|---|
| `llm_call` | One round-trip to the LLM |
| `tool_execution` | One tool invocation |
| `script_execution` | A script tool's execution |
| `user_interaction` | Time waiting for user reply |
| `workflow_control` | Plan-level state transitions |
| `topic_switch` | Conversation topic change |
| `subflow_call` | Flow/subflow dispatch |

**Interpreting results:**
- Sort by `duration_ms` DESC — the top entry is the bottleneck
- If `llm_call` dominates, the model is slow (check model config, context length)
- If `tool_execution` dominates, a specific tool is slow (check the tool script)
- If `user_interaction` dominates, the agent spent most time waiting for the user (not a performance issue)
- Compute **Orchestration Overhead** = Total Duration - LLM Time - Tool Time. If this is high, the platform routing/orchestration is the bottleneck.

> **Note:** Performance events are only captured if `sn_aia.enable_perf_logs = true`. If no events are found, check this system property.

---

### Step 8: Check User Feedback (optional)

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sn_aia_execution_feedback
  query: execution_plan=<plan_sys_id>
  fields: ["sys_id","rating","feedback_text","sys_created_on"]
  limit: 5
```

---

### Step 9: Check External Agent Calls (if applicable)

If the agent talks to external agents (A2A/MCP), check these tables:

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sn_aia_external_agent_exec_history
  query: execution_plan=<plan_sys_id>
  fields: ["sys_id","request","response","status","duration_ms"]
  limit: 10
```

```
servicenow_query_records
  tableName: sn_aia_external_agent_callback_registry
  query: execution_plan=<plan_sys_id>
  fields: ["sys_id","expected_at","received_at","status"]
  limit: 10
```

**What to look for:**
- `expected_at` vs `received_at` — large gap means the external agent is slow or hung
- `status` — did the callback complete?

---

### Step 10: Conversational Framework Tables (Optional)

> **When to use:** These tables are populated when the agent runs through the **Virtual Agent / Now Assist conversational framework** (e.g., via Now Assist panel, Virtual Agent widget). Skip this step if the agent was invoked directly via API or background script.

#### Conversation Tasks

```
servicenow_query_records
  tableName: sys_cs_conversation_task
  query: conversation=<conversation_sys_id>
  fields: ["sys_id","topic_type","state","calling_task","context","sys_created_on","sys_updated_on"]
  limit: 20
```

**Conversation task state indicators:**

| State | Severity |
|---|---|
| `completed` | OK |
| `faulted`, `canceled`, `abandoned`, `timedOut` | ERROR |
| `init`, `greet`, `gatherData`, `invokeAction`, `confirm`, `actionInProgress`, `suspended` | WARNING (in-progress) |

#### FDIH Invocations (Flow Designer Integration Hub)

```
servicenow_query_records
  tableName: sys_cs_fdih_invocation
  query: calling_cs_conversation_task.conversation.sys_id=<conversation_sys_id>
  fields: ["sys_id","name","response_state","type","execution_mode","error","outputs","sys_created_on","sys_updated_on"]
  limit: 20
```

**FDIH state indicators:**

| State | Severity |
|---|---|
| `COMPLETE` | OK |
| `ERROR`, `CANCELLED`, `TIMED_OUT` | ERROR |
| `IN_PROGRESS` | WARNING |

#### AIA Step Logs

```
servicenow_query_records
  tableName: sys_cs_aia_step_log
  query: conversation_id=<conversation_sys_id>
  fields: ["sys_id","step_name","bundle_name","state","status","response","additional_args","parent_step","execution_plan_id","sys_created_on","sys_updated_on"]
  limit: 30
```

**AIA step log state indicators:**

| State/Status | Severity |
|---|---|
| `completed` | OK |
| `errored`, `error`, `cancelled` | ERROR |
| `pending`, `processing`, `skipped` | WARNING |

**What to look for:**
- Steps with empty `response` AND empty `additional_args` — indicates a step that produced no output
- Steps in `errored` state — check `response` field for error details
- `parent_step` field — builds a hierarchy of step execution

---

## Phase 3: Diagnostic Checklist

After collecting data from Phase 2, run through this structured checklist before presenting findings. Mark each item as PASS, FAIL, or SKIP:

### Core Health Checks

| # | Check | Table | Condition | Severity |
|---|---|---|---|---|
| 1 | Execution plan completed | `sn_aia_execution_plan` | `state` = `completed` | CRITICAL if not |
| 2 | No execution task errors | `sn_aia_execution_task` | No tasks with `status` = `error` or `cancelled` | CRITICAL |
| 3 | No tool execution failures | `sn_aia_tools_execution` | No tools with `execution_status` in (`error`, `timeout`, `cancelled`) | CRITICAL |
| 4 | No GAIC error codes | `sys_generative_ai_log` | No records with non-empty `error_code` | CRITICAL — use error code reference above |
| 5 | No LLM empty responses | `sys_generative_ai_log` | All records have non-empty `response` | WARNING |
| 6 | No LLM error messages | `sys_generative_ai_log` | No records with non-empty `error` field (without error_code) | ERROR |
| 7 | No syslog errors | `syslog` | No error-level entries in time window | WARNING |
| 8 | Performance within bounds | `sn_aia_perf_event` | No single span > 30s | WARNING if > 10s, ERROR if > 30s |
| 9 | Reasonable ReAct iterations | `sn_aia_execution_task` | Count of `gen_ai` type tasks ≤ 10 | WARNING if > 10 (possible loop) |
| 10 | Token usage reasonable | `sys_generative_ai_log` | Total prompt tokens < 100K per call | WARNING if high |
| 11 | No phantom-success tools | `sn_aia_tools_execution` | No tool with `execution_status` = `completed` AND empty/`undefined`/`{}` `response` | CRITICAL — tool returned no data despite "success"; fix the tool script (see Runtime Contract) |

### Performance Metrics Summary

After collecting data, compute and present these metrics:

```
## Performance Summary

| Metric | Value |
|---|---|
| Total Execution Time | <execution_time_ms>ms |
| LLM Time (total) | <sum of time_taken from sys_generative_ai_log>ms |
| Tool Time (total) | <sum of execution_time_ms from sn_aia_tools_execution>ms |
| Orchestration Overhead | <execution_time - llm_time - tool_time>ms |
| LLM Calls | <count> |
| Tool Calls | <count> |
| ReAct Iterations | <count of gen_ai execution tasks> |
| Total Prompt Tokens | <sum of prompt_token_count> |
| Total Response Tokens | <sum of response_token_count> |
| Avg Tokens per LLM Call | <total_tokens / llm_calls> |
| Slowest Operation | <category>: <duration_ms>ms |
| LLM P95 Latency | <from execution plan> |
| Tool P95 Latency | <from execution plan> |
```

---

## Phase 4: Root Cause Classification

After the diagnostic checklist, classify the issue using this decision tree:

### Debug-by-Symptom Playbook

| Symptom | Start here | Then drill into |
|---|---|---|
| **Agent gave a wrong or weird answer** | LLM Log (`sys_generative_ai_log`) → read the `prompt` field | Was the prompt correct? Were variables filled in? Was the tool list complete? |
| **Agent emitted empty / placeholder / blank values despite tools "succeeding"** | Tool Execution (`sn_aia_tools_execution`) → `execution_status = completed` but `response` empty/`undefined` (phantom success) | The tool script returned `undefined`. Check it returns a value on every path; most often it used `export function`/`require`/a `dist/` bundle instead of a plain-JS IIFE — see Runtime Contract in `/sn-aia-agent-builder` |
| **Agent says "I don't have any instructions or actions"** | LLM Log `prompt` field — the tool list section is empty | Check agent's tool wiring in AI Agent Studio |
| **A tool failed** | Tool Execution filtered by plan → `execution_status` and `error_message` | Then Syslog around that timestamp |
| **LLM returned an error code** | LLM Log `error_code` field → look up in GAIC Error Code Reference above | Follow the workaround for that specific code |
| **Guardrail blocked the response** | LLM Log `error_code` = 300000/300100/300200/300300 | Check `sys_generative_ai_metric` for flagged categories |
| **Run is stuck `in_progress` and never completes** | Execution Task for the plan, sort by `order` desc — last row shows where it stuck | Check Syslog around that time |
| **Run is slow** | Performance Event for the plan, sort `duration_ms` desc | Identify the bottleneck category. Compute LLM vs Tool vs Orchestration split. |
| **Trigger should have fired but didn't** | Syslog filtered by `source` containing `Trigger` | Look for license, ACL, or condition rejections |
| **Worked yesterday, broken today, no plugin update** | Update XML (`sys_update_xml`) with `category = customer` on the agent, tools, prompt config | Someone modified OOB records |
| **Cost went up** | GenAI Usage Log joined to recent Execution Plans | Plus Report Metric trends. Check token counts in LLM logs. |
| **Eval score dropped after a change** | Agent Execution Eval (`sn_aia_agent_execution_eval`) filtered by `source_id` and date range | Compare before/after |
| **External / A2A agent call hung** | External Agent Callback Registry (compare `expected_at` vs `received_at`) | External Agent Execution History for the request payload |

### Failure Pattern Taxonomy

Once you've identified the symptom, classify the root cause:

| Pattern | What to look for in traces | Where to fix |
|---|---|---|
| **Prompt / Instructions** | LLM log shows wrong/missing instructions, variables not resolved | Agent instructions, role, or prompt config |
| **Tool Wiring** | Tool list empty in LLM prompt, or tool not found errors | Agent-tool M2M records (`sn_aia_agent_tool_m2m`) |
| **Tool Script Error** | Tool execution has `error_message`, script threw exception | Tool script code |
| **Rhino Module Syntax** | `error_message` or syslog contains `"exports" is not defined`, `require is not defined`, or `RhinoEcmaError … .script : Line(N)` | Tool script used `import`/`export`/`require` or a compiled `dist/` bundle. Rewrite as a plain-JS IIFE per the Runtime Contract (`/sn-aia-agent-builder`, `CLAUDE.md` PLAIN-JS IIFE blocker) |
| **Phantom Success** | Tool `execution_status = completed` but `response` empty/`undefined`/`{}`; LLM then fabricates or emits placeholders | Tool script doesn't `return` on every path (often a bare `export function` that is never invoked). Rewrite as a plain-JS IIFE that returns a value on success AND error |
| **ACL / Permission** | `access_verification` task failed, `security_violation` state_reason | ACL rules, role assignments, `runAsUser` config |
| **Data Quality** | Tool returns stale/wrong data, GlideRecord returns no results | Source data on the instance |
| **Reasoning Error** | Agent picks wrong tool or runs them in wrong order | Refine agent instructions, add decision gates |
| **Hallucination** | Agent fabricates values not in any tool output | Add grounding constraints, tighten tool output formatting |
| **Context Management** | Agent loses conversation context mid-trajectory | Check token limits, simplify multi-step workflows |
| **GAIC Pre-Processing** | Error codes 100001-100006 in LLM logs | Fix input format, prompt config, or capability attributes |
| **GAIC LLM Request** | Error codes 200000-200001 in LLM logs | Fix LLM connection, API key, or JSON format config |
| **GAIC Post-Processing** | Error codes 300000-300300 in LLM logs | Adjust guardrail thresholds, fix trust builder config |
| **GAIC Pipeline** | Error codes 400001-400002 in LLM logs | Check subflow execution logs or scriptable API calls |
| **External Dependency** | External agent/MCP call timed out or returned error | External service availability, callback config |
| **Configuration Drift** | Update XML shows customer modification to OOB records | Revert the modification |

---

## System Health Checks

Before deep-diving into a specific run, verify the platform is configured for observability:

### Check system properties

#### Resolve `read_records`:
```
servicenow_query_records
  tableName: sys_properties
  query: nameSTARTSWITHsn_aia.enable
  fields: ["name","value","description"]
  limit: 10
```

#### No match found — see [`references/background-scripts.md#system-health`](references/background-scripts.md#system-health--check-system-properties)

| Property | What it controls | Recommended |
|---|---|---|
| `sn_aia.enable_perf_logs` | Performance Event capture | `true` for debugging |
| `sn_aia.enable_conversational_debugger` | Verbose conversation-level debug data | `true` for debugging |
| `sn_aia.enable_episodic_memory` | Memory writes | Depends on agent design |
| `sn_aia.episodic_memory_limit` | Cap on memory entries per session | Default is fine |

### Check AIS status

Tell the user to verify: `<instance>/xmlstats.do?include=ais` — must show Green/ACTIVE.

### Retention warning

Execution Plans, Execution Tasks, Tool Executions, and Performance Events **do not auto-purge**. They grow forever unless an admin adds a custom cleanup job. Flag this if the instance has been running agents at scale for a long time.

---

## Comprehensive Background Script (All-in-One)

When MCP is not available, give the user the all-in-one collection script from
[`references/background-scripts.md`](references/background-scripts.md#all-in-one--comprehensive-collection-script) —
it gathers the plan, tasks, tool executions, LLM logs, messages, performance events, syslog
errors, and feedback for a given execution plan in one pass, plus a computed summary
(performance breakdown, token usage, phantom-success detection, top slowest spans).

---

## Presenting Results

After collecting and analyzing the trace data, present findings in this format:

```
## Trace Analysis: <objective excerpt>

### Execution Summary
- **Plan ID:** <sys_id>
- **State:** <state> (<state_reason>)
- **Duration:** <execution_time_ms>ms

### Performance Breakdown
| Metric | Value | % of Total |
|---|---|---|
| LLM Time | <llm_time>ms | <pct>% |
| Tool Time | <tool_time>ms | <pct>% |
| Orchestration Overhead | <overhead>ms | <pct>% |

### Efficiency
| Metric | Value |
|---|---|
| LLM Calls | <count> |
| Tool Calls | <count> |
| ReAct Iterations | <count> |
| Total Tokens | <prompt> in / <response> out |
| Avg Tokens/Call | <avg> |

### Diagnostic Checklist
| # | Check | Result |
|---|---|---|
| 1 | Plan completed | ✅ PASS / ❌ FAIL |
| 2 | No task errors | ✅ PASS / ❌ FAIL |
| 3 | No tool failures | ✅ PASS / ❌ FAIL |
| 4 | No GAIC error codes | ✅ PASS / ❌ FAIL: <code> — <name> |
| 5 | No empty LLM responses | ✅ PASS / ⚠️ WARN |
| 6 | No syslog errors | ✅ PASS / ⚠️ WARN |
| 7 | Performance OK | ✅ PASS / ⚠️ WARN: <bottleneck> |
| 8 | No phantom-success tools | ✅ PASS / ❌ FAIL: <tool> returned empty despite success |

### Root Cause
**Pattern:** <pattern from taxonomy>
**Description:** <what went wrong>
**Evidence:** <specific data from the trace>

### Findings

| # | Layer | Finding | Severity |
|---|---|---|---|
| 1 | Tool Execution | Tool "Get Incidents" returned error: "ACL denied" | CRITICAL |
| 2 | LLM (GAIC) | Error code 200000: LLM execution error — invalid API key | CRITICAL |
| 3 | Performance | LLM call took 45s (P95 is 8s) | WARNING |

### Recommended Fixes
1. <specific fix with before/after values>
2. <specific fix>

### Next Steps
- Run `/sn-aia-agent-audit` to check agent configuration
- Run `/sn-aia-agent-builder` to fix tool wiring
- Re-run the agent and re-analyze with `/sn-aia-trace-analyzer`
```

---

## Cross-References

| If you need to... | Use this skill |
|---|---|
| Debug eval infrastructure (null results, Auto Chat issues) | `/sn-eval-runner-builder` |
| Audit agent config against best practices | `/sn-aia-agent-audit` |
| Fix a tool script (phantom success, Rhino module-syntax error) — see its Runtime Contract section | `/sn-aia-agent-builder` |
| Fix agent files (instructions, tools, wiring) | `/sn-aia-agent-builder` |
| Create test cases for systematic evaluation | `/sn-aia-dataset-builder` |
| Set up eval metrics and publish a version | `/sn-eval-runner-builder` (Phase 0) |
| Generate an eval runner for programmatic eval runs | `/sn-eval-runner-builder` |
