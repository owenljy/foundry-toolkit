---
name: spec
description: Transform discovery findings and client meeting answers into a complete PoC specification (client-approvable) and technical specification (engineering-ready), in one session. Triggers on "/sn-poc:spec", "write the spec", "spec this feature".
context: fork
agent: spec-agent
---

# Spec

Create PoC and technical specifications for this PoC.

## Pre-flight Check

1. Run `ls ./intake-docs/discovery/discovery-brief.md` to verify discovery is complete
2. If the file is not found, tell the user: "No discovery brief found. Run `/sn-poc:discover` first to prepare for the client meeting." and **stop immediately**

## Task

Transform the discovery findings and client meeting answers into:
1. A complete PoC specification the client can approve
2. A complete technical specification the engineering team can implement from

Follow your full workflow (Phase A through Phase B9). Save all output to `./intake-docs/spec/`. Follow the templates exactly for consistent output.
