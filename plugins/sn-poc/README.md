# sn-poc

Claude Code skills that take a ServiceNow PoC feature idea from a rough
sentence to engineering-ready implementation stories. Part of the
[`foundry-suite`](../../README.md) marketplace; Phase B of the spec skill uses
whatever ServiceNow MCP is connected (`now-mcp` is the natural pair) to explore
the live instance.

---

## Start here

**New feature, first time using this plugin?** Run:

```
/sn-poc:intake <a sentence describing the feature>
```

That's the only command you need to know to get going. It runs the full
pipeline — discovery → spec → planning — pausing for your approval at each
gate, and it's safe to run again later: it detects what's already in
`./intake-docs/` and resumes from wherever you left off.

Everything below is for once you're mid-flow and want to jump to a specific
phase, or want to understand what each phase actually produces.

---

## Prerequisites

- None required to start — `/sn-poc:intake` works from a single sentence.
- **A ServiceNow MCP** (e.g. `now-mcp`) makes Phase B of the spec step
  (technical design) much better — it lets the agent look at the real instance
  (existing tables, roles, ACLs) instead of designing blind. Optional; the spec
  step still works without it.

## Installation

Install from the `foundry-suite` marketplace:

```
/plugin marketplace add <REPO_URL>
/plugin install sn-poc@foundry-suite
/reload-plugins
```

`sn-poc` is **skills-only** — no setup form, no connection details of its own.

---

## The pipeline

```
   feature idea
        │
        ▼
 1. Discovery ──► discovery-brief.md + index.html  ──►  [client meeting]
        │                                                      │
        ▼                                                      │
 2. Spec        ──► index.html (PoC spec  ─gate─►  tech spec) ◄┘
        │
        ▼
 3. Planning    ──► stories/, dependency-graph.md, plan-summary.md
```

Each arrow is a **hard gate** — the pipeline stops and waits for your explicit
approval before crossing it. Nothing runs ahead of you.

| Phase | Skill | What it produces | Where it's saved |
|---|---|---|---|
| 1. Discovery | `/sn-poc:discover` | Challenge points + client meeting questions + end-user FAQ, in one shareable page | `./intake-docs/discovery/` |
| 2. Spec | `/sn-poc:spec` | A client-approvable PoC spec, then (after approval) a full technical spec | `./intake-docs/spec/` |
| 3. Planning | `/sn-poc:planning` | Self-contained implementation stories with interface contracts, in execution order | `./intake-docs/planning/` |

## Skills

| Skill | What it does |
|---|---|
| `intake` | **Entry point.** Runs the full pipeline above in one flow, auto-detecting and resuming from wherever the feature currently stands. |
| `discover` | Stress-tests the feature idea, generates client meeting questions, anticipates end-user FAQ. Can scan the project for existing call notes/transcripts first (asks before reading anything). |
| `spec` | Turns client meeting answers into a PoC spec the client can approve, then a technical spec (data model, security, UI, automation) the engineering team can build from. |
| `planning` | Decomposes the technical spec into numbered stories with ordered implementation steps and exact-name interface contracts between them. |

## Where to start

| Situation | Command |
|---|---|
| Brand new feature idea | `/sn-poc:intake <idea>` |
| Have call notes / sales transcript already in the project | `/sn-poc:intake` — Discovery will find and offer to use them |
| Just back from the client meeting, discovery already done | `/sn-poc:intake` (auto-resumes at Spec) or `/sn-poc:spec` directly |
| PoC spec approved, need the tech spec | Continue in the same `/sn-poc:spec` session — Phase B follows automatically |
| Tech spec done, need a story backlog | `/sn-poc:intake` (auto-resumes at Planning) or `/sn-poc:planning` directly |
| Want to redo just one phase | Re-run that phase's skill directly (`/sn-poc:discover`, `/sn-poc:spec`, or `/sn-poc:planning`) |

## Output

All artifacts live in `./intake-docs/` in your project (not inside the
plugin), as single self-contained `index.html` files where possible — each one
embeds a `#structured-data` JSON block that the next phase reads directly, and
has an Export Markdown button for pulling content out as text/git-friendly
`.md`. Planning's stories are the exception: plain Markdown files under
`./intake-docs/planning/stories/`, written to be tool-agnostic — no mention of
Claude, MCP, or any specific tool — so any engineer can pick them up.

## Standards reference

`spec` (Phase B) and `planning` load ServiceNow architecture standards
on demand from [`standards-index.md`](standards-index.md) — only the docs for
component types the feature actually touches (tables, ACLs, scoped-app
conventions, integrations), not the whole set every time.
