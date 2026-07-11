# Discovery Templates

> Reference file for discovery-agent and faq-agent. These templates define the exact structure of all discovery output files. Follow them precisely.

---

## discovery-brief.md

```markdown
# Discovery Brief: <Feature Name>

**Prepared:** <date>
**Status:** draft | approved

## What We're Looking At

<1-2 sentence plain-language summary of the feature idea being evaluated.>

---

## Challenge Points

> Assumptions this idea rests on that may not hold. Review these before the meeting — if the client's answers invalidate a challenge, great. If they confirm it, the scope or approach may need to change.

### 1. <Assumption being challenged>

**Risk if wrong:** <what breaks or changes if this assumption is false>
**Priority:** Blocker | Risk to manage

### 2. <Assumption being challenged>

**Risk if wrong:** <consequence>
**Priority:** Blocker | Risk to manage

<Repeat for each challenge point — aim for 3-5 total>

---

## Discovery Questions

> Questions to ask in the client meeting. Grouped by theme. Marked [BLOCKER] if design cannot start without the answer, [CONTEXT] if useful but not blocking, or [CONFIRMED from <source>] if pre-existing call notes, sales discussion, or other scanned material already answers it — in that case write the answer inline instead of leaving it open.

### User Needs

- [BLOCKER] <question — written so it can be asked verbatim>
- [CONTEXT] <question>
- [CONFIRMED from <source>] <question> → <answer>

### Current State

- [BLOCKER] <question>
- [CONTEXT] <question>
- [CONFIRMED from <source>] <question> → <answer>

### Constraints

- [BLOCKER] <question>
- [CONTEXT] <question>
- [CONFIRMED from <source>] <question> → <answer>

### Success Definition

- [BLOCKER] <question>
- [CONTEXT] <question>
- [CONFIRMED from <source>] <question> → <answer>

---

## What Good Looks Like After This Meeting

<1-3 sentences describing what you need to walk away with to unblock design. What answered questions would make you confident to start `/sn-poc:spec`?>
```

---

## customer-faq.md

```markdown
# Customer FAQ: <Feature Name>

**Prepared:** <date>

> Anticipated questions from end users. Use this to prepare the team for rollout conversations and to identify what belongs in help documentation.

---

## Will this change how I work?

| Question | Answer | Status | Channel |
|----------|--------|--------|---------|
| <user question, informal first-person> | <draft answer, 1-3 sentences, plain language> | Confirmed / TBD: <what's needed> | Help doc / Onboarding / Internal only |

## What happens to my existing [X]?

| Question | Answer | Status | Channel |
|----------|--------|--------|---------|
| <question> | <answer> | <status> | <channel> |

## Who can see or access this?

| Question | Answer | Status | Channel |
|----------|--------|--------|---------|
| <question> | <answer> | <status> | <channel> |

## What if something goes wrong?

| Question | Answer | Status | Channel |
|----------|--------|--------|---------|
| <question> | <answer> | <status> | <channel> |

## Do I have to use this?

| Question | Answer | Status | Channel |
|----------|--------|--------|---------|
| <question> | <answer> | <status> | <channel> |

---

## TBD Summary

> Answers that cannot be confirmed until open questions are resolved. Review after the client meeting.

| Question | Blocked By |
|----------|------------|
| <unanswered FAQ question> | <which discovery question or decision this depends on> |
```

---

## client-brief.md

```markdown
# <Feature Name> — Project Brief

**Prepared for:** <Client Name / Team>
**Date:** <date>

---

## What We're Proposing

<2-3 sentences in plain business language describing the feature. No technical terms. Written so someone who has never used the system can understand it.>

---

## Why This Matters

<The problem this solves. Be specific about who is affected and what currently happens without this feature.>

---

## What We Need From You

<Specific decisions or information the client must provide before design can proceed. Framed as clear asks, not vague requests.>

- <Ask 1 — e.g., "Confirm whether self-check-in should be opt-in for individual employees or mandatory for everyone">
- <Ask 2>
- <Ask 3>

---

## What Happens Next

| Step | What | When |
|------|------|------|
| 1 | <action — e.g., "Client meeting to align on the asks above"> | <timeframe — e.g., "This week"> |
| 2 | <action — e.g., "Full PoC and technical specification"> | <timeframe> |
| 3 | <action — e.g., "Implementation and testing"> | <timeframe> |

---

*Prepared by <team/individual>. Questions? Contact <contact>.*
```

---

## index.html

`index.html` is the **only output artifact** for the discovery phase. It is the source of truth — there are no separate `.md` files. The spec-agent reads from it; users edit it inline in the browser; the Export Markdown button derives `.md` content on demand.

### How to generate

1. Copy `./plugins/sn-poc/skills/discover/index-template.html` verbatim
2. Fill every `{{PLACEHOLDER}}` with real content (placeholders and their expected content are documented in the template's comment block)
3. Populate the `#structured-data` JSON block — the spec-agent reads this directly
4. Save to `./intake-docs/discovery/index.html`

See `index-template.html` for the full component reference (cards, collapsibles, badges, tables, editable regions). The navigation sidebar, inline editing, Export Markdown, Save HTML, and Reset are all built into the template — do not reimplement them.

