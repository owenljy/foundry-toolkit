---
name: snapp-architect
description: Transform product specifications into detailed technical specifications. Triggers on "/snapp-architect", "create tech spec", "design architecture".
argument-hint: <FEATURE_ID>
context: fork
agent: architect-agent
---

# Architect

Create a technical specification for feature `$ARGUMENTS`.

## Pre-flight Check

1. Run `ls ./specs/$ARGUMENTS/brainstorm/specification.md` to verify the product specification exists
2. If the `ls` command fails (file not found), tell the user: "No product specification found for `$ARGUMENTS`. Run `/snapp-brainstorm` first to create one." and **stop immediately**

## Task

Transform the product specification into a complete technical specification by following your full workflow (Phase 1 through Phase 8). Save all output to `./specs/$ARGUMENTS/architecture/`. Follow the templates exactly for consistent output.

If no Feature ID was provided above, ask the user: "Which feature would you like to architect? Please provide the Feature ID (e.g., `visitor-rsvp`)."
