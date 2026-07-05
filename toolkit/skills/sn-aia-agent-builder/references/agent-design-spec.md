# Agent Design Spec (the IR)

> **Supported:** ServiceNow Zurich+. This is the durable, platform-agnostic
> contract between the interview and the code. It expresses **intent + architecture**
> — *what* the agent is — not Fluent syntax. The emitter
> (`references/now-sdk-emitter.md`) turns it into `AiAgent()` /
> `AiAgenticWorkflow()`. When the platform/SDK changes, only the emitter changes;
> this spec and the interview do not.

The interview (SKILL.md Step 1) fills this in. You present it to the user as the
**architecture review gate** *before* generating any file. It is the thing the
user reads, corrects, and approves.

## Format

Emit the spec as one fenced ```yaml block in chat. It is a review artifact, not a
deployed file — keep it readable.

```yaml
# === Agent Design Spec ===
intent: >
  One paragraph, in the user's words: what problem this solves and for whom.

architecture:
  shape: single_agent | workflow        # see "Workflow vs Single Agent" in SKILL.md
  agents:                                # one entry for single_agent; 2+ for workflow
    - name: Incident Triage Agent
      role: >
        Persona sentence — "You are an expert … specializing in …".
      example_questions:                 # drives instructions + the smoke test
        - "What is the priority of INC0010001?"
      access:                            # who can INVOKE (→ securityAcl)
        type: any_authenticated | specific_role | public
        roles: [itil]                    # only if specific_role
      run_as:                            # execution identity
        mode: dynamic_user | ai_user
        roles: [itil]                    # dynamic_user → dataAccess.roleMap (names!)
        user: ""                         # ai_user → sys_user reference
      active_on_deploy: true
      triggers:                          # [] = manual only
        - type: record_create_or_update
          target_table: incident
          condition: active=true^priority=1
          objective: "Triage incident: ${number}"
      tools:                             # see tool spec below
        - name: Get Incident
          kind: crud                     # oob | rag | capability | subflow | action | catalog | topic | mcp | crud | script
          purpose: "Look up an incident by number."
          reuse: new | reuse            # reuse = existing instance resource (from discovery)
          mutates_state: false          # true → copilot in the emitter
          # kind-specific:
          ref_id: ""                    # subflow/action/catalog/topic/capability/mcp → existing sys_id or name
          crud: { table: incident, op: lookup, return: [number, priority, state] }
          rest: { vendor: "", endpoint: "", one_call: true }   # script tools only
  workflow:                              # only when shape: workflow
    name: Incident Ops Workflow
    execution_mode: autopilot | copilot
    members: [Incident Triage Agent, Incident Resolve Agent]

connections:                             # external HTTP, if any → now-sdk Alias()
  - name: "Datadog connection"
    vendor: Datadog

scope:
  mode: single | two_scope               # two_scope keeps eval out of the customer package
  agent_scope: ""
  eval_scope: ""                         # only if two_scope

now_sdk:
  present: true                          # builder requires now-sdk in repo deps
  notes: ""                              # any gap that needs Record() — should be rare
```

## Rules for filling it

- **Don't invent.** Pre-fill from the user's free-text (express lane), then ask
  only the genuinely-missing fields, one at a time. Q1 (name) and Q2 (capabilities)
  must always be confirmed.
- **Roles are names, not sys_ids** everywhere in the spec (`roles: [itil]`). The
  emitter passes them through `roleMap`/`securityAcl` which resolve names per
  instance. Never write a sys_id in the spec.
- **Tool `kind` follows the selection priority** (OOB → reference-based → crud →
  script). `script` is last resort and triggers the Step 2b reuse/governance gate.
- **One external call per script tool** (`rest.one_call: true`). Multi-step
  sequencing belongs in instructions across separate tools, never inside one script.
- **`mutates_state`** drives `executionMode` (true → `copilot`). Read-only stays
  `autopilot`.

## What the spec does NOT contain

- No table names, column names, or sys_ids for `sn_aia_*` structure — that's the
  emitter's/now-sdk's job.
- No Fluent syntax. The spec is what you'd whiteboard with the user; the emitter
  is the only thing that knows `AiAgent()`.

The instruction/proficiency **content** (the `.md` files) and the script-tool
`.js` IIFE bodies are authored from this spec in later steps — they're the
skill-owned craft, not part of the structural spec.
