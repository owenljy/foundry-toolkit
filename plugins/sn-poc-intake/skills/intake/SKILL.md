---
name: intake
description: Full PoC intake pipeline — takes a raw feature idea all the way through discovery, spec, and planning in one flow. Auto-detects where a feature currently stands and resumes from the right phase. Use this as the single entry point; run the individual phase skills (discover/spec/planning) only to re-enter a specific phase mid-flow.
argument-hint: <feature idea or FEATURE_ID>
context: fork
agent: pipeline-agent
---

# PoC Intake

$ARGUMENTS

If no input was provided above, ask: "What feature are you working on? Give me a rough idea (to start from scratch) or a Feature ID (to resume where you left off)."

## How this works

This skill runs the full intake flow in sequence:

1. **Discovery** — challenge the idea, generate client meeting questions, produce a client-ready brief
2. **Spec** — turn client meeting answers into a product spec (client-approvable) and technical spec (engineering-ready)  
3. **Planning** — decompose the tech spec into self-contained implementation stories

Each phase gates on the previous one. You will be prompted before crossing each boundary — nothing runs ahead of you.

**Resuming mid-flow:** the pipeline detects what already exists in `./specs/<FEATURE_ID>/` and picks up from the right phase automatically.

**Re-entering a specific phase:** use `/sn-poc-intake:discover`, `/sn-poc-intake:spec`, or `/sn-poc-intake:planning` directly.
