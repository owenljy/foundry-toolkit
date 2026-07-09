# Discovery Templates

> Reference file for discovery-agent and faq-agent. These templates define the exact structure of all discovery output files. Follow them precisely.

---

## discovery-brief.md

```markdown
# Discovery Brief: <Feature Name>

**Feature ID:** `<feature-id>`
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

> Questions to ask in the client meeting. Grouped by theme. Marked [BLOCKER] if design cannot start without the answer, [CONTEXT] if useful but not blocking.

### User Needs

- [BLOCKER] <question — written so it can be asked verbatim>
- [CONTEXT] <question>

### Current State

- [BLOCKER] <question>
- [CONTEXT] <question>

### Constraints

- [BLOCKER] <question>
- [CONTEXT] <question>

### Success Definition

- [BLOCKER] <question>
- [CONTEXT] <question>

---

## What Good Looks Like After This Meeting

<1-3 sentences describing what you need to walk away with to unblock design. What answered questions would make you confident to start `/sn-poc-intake:spec`?>
```

---

## customer-faq.md

```markdown
# Customer FAQ: <Feature Name>

**Feature ID:** `<feature-id>`
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
| 2 | <action — e.g., "Full product and technical specification"> | <timeframe> |
| 3 | <action — e.g., "Implementation and testing"> | <timeframe> |

---

*Prepared by <team/individual>. Questions? Contact <contact>.*
```

---

## index.html

The discovery output must include a self-contained HTML page combining all three documents for easy sharing.

### Requirements

| Requirement | Details |
|-------------|---------|
| Self-contained | Single HTML file, inline CSS and JS, no external dependencies except Mermaid CDN |
| No login required | Works offline or shareable by link |
| Responsive | Readable on desktop and tablet |
| Print-friendly | Client brief section prints cleanly on one page |

### Required Sections

1. **Header** — Feature name, date, status
2. **Client Brief** — The `client-brief.md` content, formatted for easy reading
3. **Discovery Brief** — Challenge points + discovery questions
4. **Customer FAQ** — Q&A tables grouped by concern type, with TBD summary

### Navigation

Sidebar with links to each section. Discovery brief and FAQ sections collapsible for cleaner sharing with clients (show only the client brief by default).

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Discovery — FEATURE_NAME</title>
  <style>
    :root {
      --bg: #1a1a2e;
      --sidebar-bg: #252542;
      --border: #3d3d5c;
      --text: #e0e0e0;
      --text-muted: #888;
      --accent: #f59e0b;
      --card-bg: #2a2a4a;
      --table-header: #1e1e3a;
      --table-stripe: #252545;
      --blocker: #ef4444;
      --context: #3b82f6;
      --tbd: #f59e0b;
      --confirmed: #22c55e;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); }
    .layout { display: flex; height: 100vh; }

    .sidebar { width: 260px; background: var(--sidebar-bg); border-right: 1px solid var(--border); padding: 20px 0; overflow-y: auto; flex-shrink: 0; }
    .sidebar h1 { font-size: 15px; padding: 0 20px 16px; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
    .sidebar nav a { display: block; padding: 8px 20px; color: var(--text-muted); text-decoration: none; font-size: 13px; border-left: 3px solid transparent; }
    .sidebar nav a:hover { color: var(--text); background: rgba(245, 158, 11, 0.1); border-left-color: var(--accent); }
    .sidebar .nav-section { font-size: 11px; text-transform: uppercase; color: var(--text-muted); padding: 16px 20px 4px; letter-spacing: 0.05em; }

    .main { flex: 1; overflow-y: auto; scroll-behavior: smooth; padding: 32px 48px; max-width: 960px; }
    .section { padding-bottom: 48px; border-bottom: 1px solid var(--border); margin-bottom: 32px; }
    .section:last-child { border-bottom: none; }

    h2 { font-size: 22px; margin-bottom: 8px; scroll-margin-top: 16px; }
    h3 { font-size: 16px; margin: 24px 0 8px; color: var(--accent); }
    p, li { margin: 8px 0; }
    ul, ol { padding-left: 20px; }

    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th { background: var(--table-header); text-align: left; padding: 8px 12px; font-weight: 600; border-bottom: 2px solid var(--border); }
    td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    tr:nth-child(even) td { background: var(--table-stripe); }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-blocker { background: rgba(239, 68, 68, 0.2); color: var(--blocker); }
    .badge-context { background: rgba(59, 130, 246, 0.2); color: var(--context); }
    .badge-tbd { background: rgba(245, 158, 11, 0.2); color: var(--tbd); }
    .badge-confirmed { background: rgba(34, 197, 94, 0.2); color: var(--confirmed); }

    .challenge-card { background: var(--card-bg); border-left: 3px solid var(--blocker); border-radius: 0 8px 8px 0; padding: 16px 20px; margin: 12px 0; }
    .challenge-card.risk { border-left-color: var(--tbd); }

    .brief-box { background: var(--card-bg); border-radius: 8px; padding: 24px 28px; margin: 12px 0; border: 1px solid var(--border); }
    .brief-box h3 { margin-top: 0; }

    .collapsible-header { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px; }
    .collapsible-header::before { content: '▶'; font-size: 11px; transition: transform 0.2s; }
    .collapsible-header.open::before { transform: rotate(90deg); }
    .collapsible-body { display: none; margin-top: 12px; }
    .collapsible-body.open { display: block; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <h1>FEATURE_NAME</h1>
      <nav>
        <div class="nav-section">Client</div>
        <a href="#brief">Client Brief</a>

        <div class="nav-section">Team Prep</div>
        <a href="#challenges">Challenge Points</a>
        <a href="#questions">Discovery Questions</a>
        <a href="#faq">Customer FAQ</a>
        <a href="#tbd">TBD Summary</a>
      </nav>
    </aside>

    <main class="main">

      <div id="brief" class="section">
        <h2>Client Brief</h2>
        <!-- Render client-brief.md content here -->
        <!-- Use .brief-box divs for each section -->
      </div>

      <div id="challenges" class="section">
        <h2>Challenge Points</h2>
        <!-- For each challenge, use .challenge-card (add class "risk" for Risk to manage) -->
      </div>

      <div id="questions" class="section">
        <h2>Discovery Questions</h2>
        <!-- Group by theme (h3), render questions as list items with badges -->
        <!-- [BLOCKER] → <span class="badge badge-blocker">BLOCKER</span> -->
        <!-- [CONTEXT] → <span class="badge badge-context">CONTEXT</span> -->
      </div>

      <div id="faq" class="section">
        <h2>Customer FAQ</h2>
        <!-- For each concern group, collapsible h3 section -->
        <!-- Status: Confirmed → badge-confirmed, TBD → badge-tbd -->
      </div>

      <div id="tbd" class="section">
        <h2>TBD Summary</h2>
        <!-- Table of unanswered FAQ questions and what blocks them -->
      </div>

    </main>
  </div>

  <script>
    document.querySelectorAll('.collapsible-header').forEach(h => {
      h.addEventListener('click', () => {
        h.classList.toggle('open');
        h.nextElementSibling.classList.toggle('open');
      });
    });
  </script>
</body>
</html>
```
