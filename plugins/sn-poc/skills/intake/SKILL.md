---
name: intake
description: Full PoC intake pipeline — takes a raw PoC idea all the way through discovery, spec, and planning in one flow. Auto-detects where the PoC currently stands and resumes from the right phase. Use this as the single entry point; run the individual phase skills (discover/spec/planning) only to re-enter a specific phase mid-flow.
argument-hint: <PoC idea>
context: fork
agent: pipeline-agent
---

# PoC Intake

$ARGUMENTS

If no input was provided above, check `./intake-docs/` for existing progress first. If nothing exists yet, ask the user: "What PoC are you working on? Give me a rough idea — even a sentence is enough to start."

## How this works

This skill runs the full intake flow in sequence:

1. **Discovery** — challenge the idea, generate customer meeting questions, produce a customer-ready brief
2. **Spec** — turn customer meeting answers into a PoC spec (customer-approvable) and technical spec (engineering-ready)  
3. **Planning** — decompose the tech spec into self-contained implementation stories

Each phase gates on the previous one. You will be prompted before crossing each boundary — nothing runs ahead of you.

**Resuming mid-flow:** the pipeline detects what already exists in `./intake-docs/` and picks up from the right phase automatically.

**Re-entering a specific phase:** use `/sn-poc:discover`, `/sn-poc:spec`, or `/sn-poc:planning` directly.
