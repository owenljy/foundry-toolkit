---
name: snapp-planning
description: Transform technical specifications into self-contained stories with implementation steps. Triggers on "/snapp-planning", "plan this feature", "create stories".
argument-hint: <FEATURE_ID>
context: fork
agent: planning-agent
---

# Planning

Create stories with implementation steps for feature `$ARGUMENTS`.

## Pre-flight Check

1. Run `ls ./specs/$ARGUMENTS/architecture/technical-spec.md` to verify the technical specification exists
2. If the `ls` command fails (file not found), tell the user: "No technical specification found for `$ARGUMENTS`. Run `/snapp-architect` first to create one." and **stop immediately**

## Task

Transform the technical specification into self-contained User Stories with embedded Implementation Steps by following your full workflow (Phase 1 through Phase 7). Save all output to `./specs/$ARGUMENTS/planning/`. Follow the templates exactly for consistent output.

If no Feature ID was provided above, ask the user: "Which feature would you like to plan? Please provide the Feature ID (e.g., `visitor-rsvp`)."
