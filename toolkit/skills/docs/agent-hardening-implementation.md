# Agent-hardening patterns — implementation spec

Status: **proposed (rev. 2 — reviewed against the live files, blockers/drift fixed)** ·
Enforcement stance: **soft** (see §2) · Scope: clusters **A–D**

> **Rev-2 note.** This spec was reviewed point-by-point against the actual toolkit files
> (per `CLAUDE.md` M1–M6). Several anchors it cited from memory had drifted, two embedded
> skeletons had real bugs (`x_<scope>` double-prefix → dead guard; `<idField>` → `node
> --check` failure), and a few acceptance items were unsatisfiable by the instructions as
> written. All are corrected inline below, with a *(note: …)* marking each change. The
> corrected skeletons pass `node --check`; the corrected `[12]` regex was verified to no
> longer false-fire on longer hex literals.

This is an implementation spec, not reference material. It describes changes to make
to this toolkit so that generated agents inherit four production-hardening patterns.
Execute it against a `feat/honest-agent-patterns` branch, then delete or archive this
file once the work has landed and the affected SKILL/doc/script files are the source
of truth.

---

## 0. Where these patterns come from

The patterns are lifted from a production ServiceNow agentic application (the "Endpoint
Deploy Agent" / Tanium framework, `scope: x_fde_tanium`) and generalized to be
domain-neutral. They are **judgment and design patterns**, not structural facts about
the `sn_aia_*` tables — so they belong in this toolkit's layer (see `CLAUDE.md` M1–M6),
not in now-sdk.

The four clusters and their one-line invariants:

| Cluster | Invariant | Source artifact (reference only) |
|---|---|---|
| **A — honest run outcomes** | "reported done" ≠ "verified done"; every run reaches a labeled terminal outcome; escalation is a first-class outcome | `TaniumVerify.assess()`, `TaniumDeployOrchestrator._escalate()` |
| **B — testability seam (dry-run / mock)** | a state-mutating tool can run its full real code path and skip only the irreversible side-effect, returning a distinctly-labeled result | `TaniumLive` `dryRunEnabled()` guards |
| **C — agent boundary (long-running work)** | never busy-wait inside an agent conversation; hand long polling/waiting to an async driver | `TaniumConfig` + scheduled poller (out of scope to generate — see §7) |
| **D — config externalization** | no customer/environment-specific value is hardcoded; read from a system property (safe default) or a connection alias at runtime | `TaniumConfig._p()` |

All four are **additive and backward-compatible**: existing generated agents and tool
scripts keep working, dry-run is opt-in, and the new verify step is required only for
state-mutating/deploy agents.

---

## 1. Design constraints (apply to every change below)

1. **Judgment → prose; structural grep → the scan.** A check that can be expressed as a
   deterministic `rg`/`grep` goes into `scripts/anti-pattern-scan.sh` as a "MUST be zero"
   check. A check that requires reading intent (is there a verify step? is there a
   dry-run guard?) goes into `sn-aia-agent-audit/SKILL.md` as a judgment **warning** — it
   cannot be a hard scan blocker.
2. **Single source of truth.** Do not paste a check or a code shape into more than one
   place. The scan script owns scan logic; `docs/tool-output-patterns.md` owns output
   shapes; the `scripts/tool-scripts/*.template.js` files own the known-good tool code.
   Everything else **links** to those.
3. **Respect the toolkit boundary.** The toolkit builds the *agent* (reasoning + tools +
   `sn_aia_*` trigger surface). It does **not** build the platform orchestration around
   the agent (ScheduledScript pollers, Business Rules, Flows). Cluster C therefore only
   *flags* the boundary and hands off — it never generates a poller. See §7.

---

## 2. Enforcement stance: soft

Only one new check is a deterministic **MUST-be-zero scan check**. Everything else is a
template default, an authoring convention, or a judgment warning that surfaces at audit
time but does not block deployment. Rationale: a hard "every mutating tool must have a
dry-run guard" rule would false-positive constantly and read as noise.

> **What "hard" means here.** The scan script (`scripts/anti-pattern-scan.sh`) is
> deliberately *informational* — it prints findings and always exits 0 (it only
> `exit 2`s when `rg` is missing). So "hard" for check [12] means the same tier as the
> existing [1]–[11]: a **MUST-be-zero, human-enforced** check — NOT a non-zero CI exit.
> The soft/hard split in this spec is *deterministic-grep-check* ([12]) vs
> *judgment-warning* (W8–W11), not *blocks-the-build* vs *doesn't*. A real CI gate that
> fails on a hit would be a separate, larger change.

| Change | Enforcement |
|---|---|
| Verify step for mutating agents (A/#1) | authoring convention in builder + audit **W8** (judgment warning) |
| Labeled terminal outcomes (A/#4) | documented vocabulary in `tool-output-patterns.md` |
| Escalate as first-class outcome (A/#5) | instruction template + audit **W9** (judgment warning) |
| Dry-run / mock guard (B/#2) | opt-in template skeleton + builder convention + audit **W11** (judgment warning) |
| Long-running → async driver (C/#3) | prose in builder decision tree + `CLAUDE.md` |
| Config externalization (D/#6) | builder rule **A4** + audit **W10** (judgment warning) |
| Hex sys_id literal in a **server script** (D/#6) | scan check **[12]** — the one deterministic MUST-be-zero grep (see the "hard" note above) |

New audit warning IDs: **W8, W9, W10, W11**. New scan check: **[12]**.

---

## 3. Cluster A — honest run outcomes (#1 verify, #4 labeled outcomes, #5 escalate)

Highest priority: these three are one coherent idea ("how a run ends honestly") and they
close the loop with the existing `sn-aia-trace-analyzer` (which catches phantom success
at *runtime*; this makes the builder *prevent* it at generation time).

### A.1 `docs/tool-output-patterns.md` — new section

Add a new top-level section **"Run-level terminal outcomes"** at the **end of the doc**
(after "Picking a pattern: decision tree"). *(Anchor note: the spec originally said "right
after the Step 8 error contract", but that heading is not last — "Anti-patterns to scan
for" and "Picking a pattern: decision tree" follow it. Appending at the doc end keeps the
tool-level material together and the new run-level material below it.)* Open the section
with a one-line "everything above is **tool**-level return shapes; this section is the
**run**-level contract" note. Content:

- The doc so far covers single-*tool* return shapes; this section adds the *run*-level
  contract.
- **Terminal outcome vocabulary** every run should resolve to exactly one of:
  `success` · `dry_run_success` · `mock_success` · `escalated`.
- **The terminal word is DERIVED from the tool return flags — tools do NOT emit the word
  themselves.** The mapping (state it once here; A.2/B.1/B.2/B.3 all inherit it):
  `dryRun: true` ⇒ `dry_run_success`; `mock: true` ⇒ `mock_success`; a verified mutating
  success ⇒ `success`; genuinely-stuck ⇒ `escalated`. This is why the tool skeletons in
  Cluster B return only the *flag* (`dryRun: true` / `mock: true`), never the word.
- **Labeling rule:** a dry-run or mock success MUST carry its distinct flag
  (`dryRun: true` / `mock: true`) so the derived terminal word can never be read as a real
  `success` by the LLM, an eval scorer, or a human reading the trail. The generated
  instructions must teach the LLM to read these flags (see A.2) — a `dryRun`/`mock` return
  means the side-effect did **not** happen.
- **Never false success:** a state-mutating run may only report `success` after an
  independent verify confirms the desired state. A verify *read* error is
  **inconclusive** — re-checked, never spun as either `success` or a hard failure.
- **Escalate is first-class:** when genuinely stuck, the run resolves to `escalated`
  (hand off to a named queue with the full trail), not a guess or a silent stop. In the
  generated agents this reuses the existing `human_agent_handoff` terminal from the Step 8
  contract — `escalated` is the *run-outcome name* for that handoff, not a second mechanism.

Cross-link this section from A.2 and A.3 rather than repeating it. *(Dropped `manual` from
the vocabulary — the original draft listed it but never defined it and nothing references
it; `escalated` covers the "returned control to a human" case.)*

### A.2 `sn-aia-agent-builder/SKILL.md`

Four edits:

1. **Step 2 (Clarify if Needed).** Add a detection: "Does the agent mutate state, deploy,
   or write to an external system?" If yes:
   - the generated instructions MUST include an independent **Verify** step before the
     agent declares success;
   - a verify-time read error is treated as **inconclusive** (re-check / escalate), never
     spun as success or failure.
2. **"File content the skill owns → `<agent>-instructions.md`" template** (the six-block
   skeleton: `# Objectives` / `# Validations` / `# Steps` / `# Expected Output` /
   `# Success Criteria` / `# Constraints`). Add two things:
   - an **optional `# Verify`** section (emitted only for mutating/deploy agents), placed
     after `# Steps` — "Before declaring success, independently confirm <desired state>
     holds. If the verify read fails, treat as inconclusive and re-check or escalate — do
     NOT report success or failure." *(Distinguish from the existing `# Success Criteria`
     block: `# Verify` is an independent **read of the mutation's end-state** with an
     inconclusive-on-read-error rule; `# Success Criteria` is the general completion
     checklist. For a mutating agent, `# Verify` is the stronger, specific gate.)*
   - **ADD a new `# Outcome` block** (after `# Steps`/`# Verify`) that enumerates the
     run-level terminal outcomes from A.1 — at minimum an explicit **success** and
     **escalated** branch. *(Anchor note: the original draft said "generalize the terminal
     branch", but the template has no terminal branch to generalize — it ends at
     `# Constraints`. This is an additive new block, consistent with the CLAUDE.md
     instruction-structure convention.)*
3. **Success-interpretation line (dry-run/mock visibility).** In the instruction guidance,
   add one line so the generated agent reads the Cluster-B flags: "If a tool returns
   `dryRun: true` or `mock: true`, the side-effect did **not** occur — report the
   dry-run/mock outcome, never a real success." This lives in the **success-interpretation**
   path, NOT the Step 8 error list (a `{success:true, dryRun:true}` return is not an error).
   Cross-link `docs/tool-output-patterns.md → "Run-level terminal outcomes"`.
4. **"The generated agent's runtime "Step 8 — Error handling" (required for API agents)"
   section** (this is the exact current heading — note the load-bearing **"(required for
   API agents)"** scope). Generalize it from "fires only on external-API `__error_code`"
   to also cover the honest-escalation case: an API error is one path into escalate; *any*
   genuinely-stuck state (bounded retries exhausted, verify inconclusive after re-check, no
   safe next action) also resolves to `escalated` with the full trail. Keep the existing
   `__error_code` scoping intact — this is an addition, not a rewrite.
   - **Because Step 8 is scoped "(required for API agents)", a mutating agent with no
     external API skips it** — so the escalate branch must ALSO be reachable from the
     `# Outcome` block added in edit 2 (which every mutating agent gets), not only here.
   - **Single-source-of-truth:** the Step 8 contract is duplicated — the canonical copy is
     in `docs/tool-output-patterns.md` ("Step 8 error contract") and the builder holds a
     condensed copy that already cross-links to it. Add the escalate branch to the
     **canonical doc copy**, and have the builder's condensed copy point at it rather than
     restating the branch (honors design-constraint #2).
   - Add a one-line cross-link: "The builder prevents phantom success here; the
     `/sn-aia-trace-analyzer` skill catches it at runtime if it slips through."

### A.3 `sn-aia-agent-audit/SKILL.md` + `CLAUDE.md`

- Add to the **Warning Checks** table (after W7):
  - **W8 — State-mutating agent without an independent verify step.** Local/judgment
    audit: the agent has a mutating/deploy tool but its instructions declare no verify
    step before success. Fix: add a `# Verify` step (see builder template).
  - **W9 — No honest terminal/escalate branch.** Instructions never define an
    `escalated`/handoff terminal outcome. Fix: add an explicit escalate branch.
- Mirror W8/W9 in the **Local audit** numbered checklist (the list that today ends at
  item 8, "Check for marketing prose"). **The Local audit list uses plain sequential
  numbering (1–8), NOT W-IDs** (its item 7 = W1, item 8 = W2) — so append them as **items
  9 and 10** that cross-reference W8 and W9, don't label the items "W8/W9".
- **Fix the now-stale audit ID range in the builder.** Builder Step 7c currently says it
  applies the audit's "blocker (B1–B9) and warning (W1–W7) checks" — but B10/B11 already
  exist today (so "B1–B9" is *already* wrong), and W1–W7 goes stale the moment W8+ land.
  Reword it to mode-relative phrasing ("all blocker and warning checks the audit reports in
  Local audit mode") so it can't drift again. *(This line lives in the builder file, not
  the audit file — fold it into the same commit.)*
- `CLAUDE.md`: under **Prompting Best Practices → End steps**, add one line that a
  state-mutating agent's concluding step set must include both a verified-success
  outcome and an honest escalate outcome. Do not duplicate the check logic — point at
  audit W8/W9.

---

## 4. Cluster B — testability seam: dry-run / mock (#2)

Goal: a state-mutating tool can run its full real code path (resolve connection, build
payload, validate) and skip **only** the irreversible side-effect, returning a distinctly
labeled result. This makes the tool eval-safe and demoable offline. The guard is read
from a system property at runtime — it runs server-side in the instance like any tool;
it is not a separate environment.

Note the distinction from Pattern 4 soft-fail: **soft-fail** handles *missing context*;
**dry-run** is an intentional no-op driven by a config switch. And a dry-run should still
perform audit/bookkeeping writes — it skips the *consequential* effect, not *all* writes.

### B.1 `scripts/tool-scripts/action-tool.template.js`

Add an **opt-in dry-run guard** after the soft-fail context checks and before the
mutation (`gr.update()`). Skeleton:

```js
    // ---- opt-in dry-run guard (remove if this tool has no irreversible effect) ----
    // Runs the real code path above; skips only the mutation below. Read from a system
    // property so an admin can flip it with no rebuild.
    // (optional) audit/bookkeeping write here — put it ABOVE this guard so it runs even
    // in dry-run; the guard skips only the *consequential* effect, not *all* writes.
    var dryRun = gs.getProperty('<scope>.dry_run') === 'true';
    if (dryRun) {
        // Return only the dryRun FLAG; the run-level terminal word (dry_run_success) is
        // derived from it per docs/tool-output-patterns.md → "Run-level terminal outcomes".
        return { success: true, dryRun: true, note: 'dry-run — mutation skipped', caseSysId: caseSysId };
    }
    // ---------------------------------------------------------------------------------
```

Two things the skeleton fixes vs the original draft (both were bugs):
- **Property key is bare `<scope>`, not `x_<scope>`.** The toolkit's `<scope>` placeholder
  already resolves to the full scoped name *including* `x_` (e.g. `x_fde_tanium`;
  `sn-eval-runner-builder` uses bare `<scope>.` everywhere). `x_<scope>.dry_run` would
  expand to `x_x_fde_tanium.dry_run` — a property that is never set, so the guard would be
  permanently dead. Add a one-line comment in the template that `<scope>` is the full name
  incl. `x_`.
- **Use the concrete field name `caseSysId`** (what this template actually uses), with an
  inline `// rename to your tool's id field` comment. The original `<idField>: <idField>`
  put an angle-bracket token in object-literal position — a hard `SyntaxError` that fails
  the acceptance gate's `node --check`. Never put a `<placeholder>` in a code (non-string)
  slot.

Update the file header comment to explain the guard and its distinction from soft-fail,
and cross-link `docs/tool-output-patterns.md → "Run-level terminal outcomes"` for the
return shape (per design-constraint #2 — the doc owns shapes, the template links to it).

### B.2 `scripts/tool-scripts/rest-tool.template.js`

This template ships **GET-only** (`var method = 'GET'`), so both blocks are written to be
inert until the author switches to a mutating verb — add explicit, `node --check`-valid
skeletons (don't leave B.2 as prose like the original draft):

- a **mock-endpoint branch**, placed right after `(function (inputs) {` and **before
  `resolveConnection`** (so a mock needs no real connection — the offline case):

  ```js
      // ---- opt-in mock-endpoint branch (remove if this tool has no external call) ----
      // Offline/eval mode: short-circuit before touching the real connection or API.
      var mockEndpoint = gs.getProperty('<scope>.mock_endpoint');   // <scope> incl. x_
      if (mockEndpoint) {
          // Return only the mock FLAG; the run-level terminal word (mock_success) is derived.
          return { success: true, mock: true, note: 'mock endpoint — real call skipped' };
      }
      // --------------------------------------------------------------------------------
  ```

- a **dry-run guard** for mutating HTTP methods, placed just before the
  `return executeAndUnwrap(...)` at the end — **method-conditional** so it is dead-inert in
  the shipped GET template and activates only once the author sets a mutating verb:

  ```js
      // ---- opt-in dry-run guard (activates only for mutating HTTP methods) ----
      if (/^(POST|PUT|PATCH|DELETE)$/.test(method) && gs.getProperty('<scope>.dry_run') === 'true') {
          return { success: true, dryRun: true, note: 'dry-run — HTTP ' + method + ' skipped' };
      }
      // ------------------------------------------------------------------------
  ```

Both opt-in and clearly commented as removable when the tool is read-only. Note the
placement trade-off in a comment: mock-before-`resolveConnection` skips
connection/credential resolution entirely (lowest fidelity, fully offline); moving it after
`resolveConnection` exercises the real connection lookup but not the API call. Use bare
`<scope>` (incl. `x_`) as in B.1.

### B.3 `docs/tool-output-patterns.md`

In the "Run-level terminal outcomes" section (A.1), document the dry-run/mock **return
shapes** and reiterate the labeling rule (`dryRun: true` / `mock: true`, terminal word
derived). This is where the shapes live; the templates link here. **B.3 is hard-coupled to
A.1** — it writes into the section A.1 creates, using its exact heading, so **A.1 must land
first** (see §8 sequencing).

### B.4 `sn-aia-agent-builder/SKILL.md`

- Place this in **Step 4 (Author script-typed tool `.js` files)** — it has the "Start from
  the known-good templates" hook where the dry-run skeleton lives. *(Not Step 2b: that step
  reasons about tool-**type** priority across all kinds; the dry-run guard is a script-level
  concern.)* Add a convention, **scoped to script-typed state-mutating tools**: "A
  state-mutating **script** tool SHOULD support a config-driven dry-run guard. This makes
  the tool eval-safe and demoable offline; the guard runs the real code path and skips only
  the side-effect." Link to `docs/tool-output-patterns.md`. Note that `action`/`subflow`
  tools get their dry-run behavior in Flow Designer, not here (consistent with §7).
- Keep it a SHOULD, not a MUST (soft enforcement).

### B.5 `sn-eval-runner-builder/SKILL.md`

Attach one note to the existing **"Instance safety gate"** callout (the "before any write"
block) as a complementary sub-point: dry-run/mock lets an eval run exercise the full real
tool path on the instance without real side-effects — prefer it over pointing eval at
production writes. **Fidelity caveat:** a dry-run/mock eval exercises tool selection and the
pre-mutation path but **not** the real side-effect, so a mutating agent still needs one
non-dry-run validation in a safe (non-prod) sandbox before go-live.

### B.6 Audit

- **W11 — State-mutating tool with no dry-run/mock guard.** Judgment warning (not a scan
  blocker): a tool that writes/mutates but has no config-driven dry-run path, so it can't
  be run safely in eval. **What to look for** (give W11 a concrete signal like every other
  warning row): a mutation (`.update()`, `.insert()`, `.setValue(`, or a
  `setHttpMethod('POST'|'PUT'|'PATCH'|'DELETE')`) with **no** preceding
  `gs.getProperty(...dry_run...)` / mock short-circuit. Fix: add the guard from the template.
- **Mirror W11 in the Local audit numbered checklist** (append as the next item after the
  W8/W9/W10 mirrors — the acceptance checklist requires all four warnings mirrored). *(This
  mirror was missing from the original draft — A.3 mirrors W8/W9 and D.2 mirrors W10, but
  B.6 only added the table row.)*

---

## 5. Cluster C — agent boundary: long-running work (#3)

Prose only. The toolkit **flags** the boundary and hands off; it does **not** generate the
async driver (see §7).

Two hooks — one **active** (fires at generation time) and one **reference** (the rationale).
*(Placement note: this is an **agent-vs-async-driver boundary** decision, not an
**agent-topology** one. "Workflow vs Single Agent" chooses between single-agent and
multi-agent-workflow; the duration axis chooses whether the wait even belongs in an agent at
all. So make it its own delimited subsection, not a fourth branch of that decision tree.)*

**C.1a — Step 2 (Clarify) active detection** in `sn-aia-agent-builder/SKILL.md`. Mirror the
A.2 pattern (which adds a live Step 2 mutating-state question) with a duration question, so
the boundary actually changes generated output rather than sitting in passive reference
prose:

> Does the task need to poll or wait for external state over time (deploy completes, a
> long-running job finishes, an approval lands)? If yes → do NOT emit a wait/sleep/poll
> loop in the agent. Emit two ordinary `sn_aia` tools instead — a state-mutating **"kick"**
> tool that starts the work and returns immediately, and a read-only **"check
> status/verdict"** tool — and flag the async-driver boundary. The scheduled poller that
> flips the state field is **out of scope** (see §7); the builder generates the two tools,
> not the driver.

**C.1b — `### Duration / boundary axis` reference subsection** in the builder (a new
delimited subsection near "Workflow vs Single Agent", not inside its decision list):

> If the task needs to poll or wait for external state over time, do NOT busy-wait inside
> the agent conversation — that is a boundary signal, not an agent job. Hand the wait to
> an async driver (a scheduled job + a state field on the request record); the agent only
> *kicks* the work and later reads the *verdict*. **This toolkit does not generate that
> poller** — it lives in the platform-orchestration layer, outside the agent.

### C.2 `CLAUDE.md`

Add the duration axis as **its own boundary/hand-off bullet** (not a fourth branch of the
"Workflow vs Single Agent Decision Tree"), mirroring one line of C.1b and pointing at the
builder's `Duration / boundary axis` subsection for detail. Name the exact target so the
cross-link resolves.

---

## 6. Cluster D — config externalization (#6)

### D.1 `sn-aia-agent-builder/SKILL.md` — anti-staleness rules

Add **A4 — Externalize customer/environment-specific values.** Generalizes A2 (no
hardcoded `sn_aia_*` sys_ids) to *all* environment-specific values:

> Do not hardcode any customer/environment-specific value (endpoint URL, queue/group
> sys_id, MID, threshold, software/serial name) in a **server script** (tool script,
> `applicability`, or `context-processing` — the Rhino contract applies to all three).
> Read it from a system property (`gs.getProperty` with a safe default) or a connection &
> credential alias at runtime, so the same built artifact behaves per-install with no
> rebuild. This is the generalization of the credential-minimization rule (Step 2b) — if a
> script can read a value from config or the connection at runtime, it must, rather than
> baking it in or taking it as an input.

### D.2 `sn-aia-agent-audit/SKILL.md`

- **W10 — Hardcoded customer/environment value in a server script.** Judgment warning,
  **scoped to what a grep can't own** (so it does not duplicate scan check [12] — design
  constraint #2): a literal endpoint URL, or **non-hex** config baked in (threshold values,
  MID/group names, software/serial strings), appearing in a server script outside the
  connection-resolution helper. Fix: externalize to a property or connection alias (rule
  A4). **The hardcoded-hex-sys_id case is owned by scan check [12] — W10 defers to it** and
  should say so, rather than re-encoding the same hex check at a softer tier.
- Mirror W10 in the Local audit checklist.

### D.3 `scripts/anti-pattern-scan.sh` — new MUST-be-zero check [12]

This is the single deterministic grep and therefore the only new **hard** (MUST-be-zero)
rule — same advisory, exit-0 tier as [1]–[11] (see the §2 "hard" note):

- **[12] — 32-char hex literal in a server script.** Scan **both** server script dirs —
  `src/server/agents/*/*-scripts/*.js` (matches `tool-scripts/` *and* `agent-scripts/`,
  the same pair check [4] already covers) — for `\b[0-9a-f]{32}\b`. This **extends** audit
  B11 (which covers `sn_aia_*` `*.now.ts` structure) to server scripts. MUST be zero.
  - **Anchor the regex with `\b…\b`** (rg's default engine supports it): the original
    unanchored `/[0-9a-f]{32}/` matches any 32-char window inside a longer hex literal, so
    a 40-char git SHA or 64-char SHA-256 constant would false-fire. Keep the class
    lowercase-only (sys_ids are lowercase).
  - Add a `// scan-allow-hex` inline escape hatch for the irreducible legit-32-char-hex
    case (a real MD5, etc.), matching how the toolkit handles other unavoidable exceptions.
- Also emit an **informational** (not "MUST be zero") line for hardcoded `https?://` URL
  literals in server scripts — heuristic, so informational only to avoid false positives
  (it will also match XML/SOAP namespace URIs like `w3.org`/`xmlsoap.org` — label it
  expected-noise, or exclude those hosts).
- **Scope caveat:** `src/server/agents/` does not exist in *this* toolkit repo (same as
  existing checks [8]/[9]), so [12] is a no-op when scanning the toolkit itself and only
  fires in a *generated/consumer* repo. Note this so acceptance item 9 ("full scan clean on
  the repo") isn't misread as having exercised [12].
- Update the header comment block (the enumerated check list at the top of the script) to
  include [12].

---

## 7. Explicitly out of scope

These belong to the platform-orchestration domain (building the *application around* the
agent), not to this agent-build toolkit. Do **not** add them:

- Generating a ScheduledScript / poller (Cluster C hands off; it does not build one).
- The `run_period` object-serialization patch (`fix-build-artifacts.py` equivalent).
- The "scoped app can't do outbound HTTP from a sync Business Rule" workaround.
- The Flow/Playbook → state-field → after-BR "bridge" pattern.
- Owning/creating the **request-record state field** the Cluster-C async driver flips —
  that field belongs to the platform-orchestration layer; the builder's "kick"/"verdict"
  tools only *read and write* it, they don't define the poller-side lifecycle.
- The staged go-live ladder as an operational runbook.

If the toolkit ever starts emitting scheduled jobs or Business Rules, revisit these — but
that would be a deliberate scope expansion, decided separately.

---

## 8. Sequencing

Recommended order (highest value first, lightest last):

1. **Cluster A** — honest run outcomes (closes the builder ↔ trace-analyzer loop).
2. **Cluster B** — dry-run / mock seam (feeds eval).
3. **Cluster D** — config externalization (one MUST-be-zero scan check + one warning).
4. **Cluster C** — agent boundary (prose only).

**Apply the clusters sequentially, one commit each — do NOT parallelize.** There is one
**hard dependency**: A.1 *creates* the "Run-level terminal outcomes" section in
`docs/tool-output-patterns.md`, and B.3 *writes into* it — so A must land before B. The
rest is safe only because it's sequential.

**Four files are edited by multiple clusters** — the most-contended is
`sn-aia-agent-audit/SKILL.md` (W8/W9 from A, W11 from B, W10 from D all land in its Warning
table + Local-audit checklist). The others: `docs/tool-output-patterns.md` (A.1 creates,
B.3 writes), `sn-aia-agent-builder/SKILL.md` (A/B/C/D all touch it), and `CLAUDE.md` (A + C).
Within each cluster commit, edit **section-creating changes before changes that reference
them** (e.g. in commit A, add the tool-output-patterns section *before* editing the builder
lines that cross-link to it).

Consider one commit per cluster, or a single PR with a section per cluster.

---

## 9. Acceptance checklist

Per the `CLAUDE.md` maintenance discipline, state what was verified — evidence, not
assertion.

- [ ] `docs/tool-output-patterns.md` has the "Run-level terminal outcomes" section **at the
      doc end**; the four-word vocabulary (`success`/`dry_run_success`/`mock_success`/
      `escalated`, no `manual`) + the flag→word derivation + labeling rule documented once,
      linked elsewhere.
- [ ] Builder emits an optional `# Verify` step **and a new `# Outcome` block** (with
      explicit success + escalated) for mutating/deploy agents; Step 8 generalized in the
      **canonical doc copy** (builder condensed copy points at it); existing `__error_code`
      scoping intact; escalate reachable from `# Outcome` for non-API mutating agents.
- [ ] Builder teaches the LLM to read `dryRun`/`mock` flags (success-interpretation path,
      not Step 8) and cross-links to `/sn-aia-trace-analyzer` (prevent vs catch).
- [ ] Audit has W8, W9, W10, W11 in the warning table (W10 scoped to URL/non-hex, deferring
      hex to [12]) **and all four mirrored** in the local-audit checklist (appended as
      plain-numbered items, not "W8"-labeled). Builder Step 7c stale "B1–B9/W1–W7" range
      reworded to mode-relative phrasing.
- [ ] `CLAUDE.md` reflects the escalate/verify end-step line and the Cluster-C duration axis
      **as its own boundary bullet** (not a fourth decision-tree branch).
- [ ] `action-tool.template.js` (bare `<scope>`, `caseSysId` key) and
      `rest-tool.template.js` (mock branch + **method-conditional** dry-run guard) have
      opt-in dry-run/mock guards; **`node --check` passes on both**.
- [ ] `scripts/anti-pattern-scan.sh` has check [12] (**`\b[0-9a-f]{32}\b`** across both
      `*/tool-scripts/` and `*/agent-scripts/`, with `// scan-allow-hex` hatch) + the
      informational URL line; header comment updated.
- [ ] `sn-eval-runner-builder/SKILL.md` notes dry-run/mock on the Instance-safety-gate
      callout, with the fidelity caveat (still needs one non-dry-run sandbox validation).
- [ ] Full `scripts/anti-pattern-scan.sh .` is clean on the repo (no new "MUST be zero"
      hits). *(Note: [12] is a no-op on this repo — no `src/server/agents/` — so a clean
      scan here does not exercise it; verify [12] against a generated repo or a fixture.)*
- [ ] Every new cross-link resolves (no dangling doc/section references).
- [ ] All changes are additive/backward-compatible (verified: dry-run opt-in; verify only
      for mutating agents; no existing generated artifact shape changed).
