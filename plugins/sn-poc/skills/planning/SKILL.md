---
name: planning
description: Transform technical specifications into self-contained stories with implementation steps. Triggers on "/sn-poc:planning", "plan this PoC", "create stories".
context: fork
agent: planning-agent
---

# Planning

Create stories with implementation steps for this PoC.

## Pre-flight Check

1. Run `ls ./intake-docs/spec/index.html` to verify the technical specification exists
2. If the `ls` command fails (file not found), tell the user: "No technical specification found. Run `/sn-poc:spec` first to create one." and **stop immediately**

## Task

Transform the technical specification into self-contained User Stories with embedded Implementation Steps by following your full workflow (Phase 1 through Phase 6). Save all output to `./intake-docs/planning/`. Follow the templates exactly for consistent output.
