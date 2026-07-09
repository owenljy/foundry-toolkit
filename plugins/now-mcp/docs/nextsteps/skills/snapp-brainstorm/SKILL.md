---
name: snapp-brainstorm
description: Transform vague feature ideas into complete product specifications. Triggers on "/snapp-brainstorm", "groom this feature", "create product spec".
argument-hint: <feature idea or description>
context: fork
agent: grooming-agent
---

# Brainstorm

Groom the following feature idea into a complete product specification:

$ARGUMENTS

If no feature idea was provided above, ask the user: "What feature would you like to groom? Please describe your idea."
