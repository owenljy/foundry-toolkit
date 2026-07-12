---
name: discover
description: Pre-meeting discovery — challenge a PoC idea, generate client meeting questions, anticipate end-user FAQ, and produce a client-ready brief. Triggers on "/sn-poc:discover", "discover this PoC", "prep for client meeting".
argument-hint: <PoC idea or description>
context: fork
agent: discovery-agent
---

# Discover

Prepare for the client meeting on this PoC idea:

$ARGUMENTS

If no PoC idea was provided above, ask the user: "What PoC are you planning to discuss with the client? Give me a rough description — even a sentence is enough to start."

## How this skill works

This skill runs two agents in sequence:

1. **discovery-agent** — challenges the idea, surfaces weak assumptions, and generates structured questions for the client meeting. Produces `discovery-brief.md`.

2. **faq-agent** — anticipates questions end users will ask, writes draft answers, and produces a client-facing brief. Produces `index.html` (the only output file — no separate `.md` files).

The faq-agent runs automatically after the discovery-agent completes and the user approves the discovery brief.
