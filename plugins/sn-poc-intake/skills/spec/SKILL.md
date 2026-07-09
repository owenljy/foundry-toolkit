---
name: spec
description: Transform discovery findings and client meeting answers into a complete product specification (client-approvable) and technical specification (engineering-ready), in one session. Triggers on "/sn-poc-intake:spec", "write the spec", "spec this feature".
argument-hint: <FEATURE_ID>
context: fork
agent: spec-agent
---

# Spec

Create product and technical specifications for feature `$ARGUMENTS`.

## Pre-flight Check

1. Run `ls ./specs/$ARGUMENTS/discovery/discovery-brief.md` to verify discovery is complete
2. If the file is not found, tell the user: "No discovery brief found for `$ARGUMENTS`. Run `/sn-poc-intake:discover` first to prepare for the client meeting." and **stop immediately**

## Task

Transform the discovery findings and client meeting answers into:
1. A complete product specification the client can approve
2. A complete technical specification the engineering team can implement from

Follow your full workflow (Phase A through Phase B10). Save all output to `./specs/$ARGUMENTS/spec/`. Follow the templates exactly for consistent output.

If no Feature ID was provided above, ask the user: "Which feature would you like to spec? Please provide the Feature ID (e.g., `visitor-rsvp`)."
