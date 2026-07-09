# Specification Template

> Reference file for the grooming-agent. This template defines the exact structure of the specification output. Follow it precisely for consistency across features.

---

## specification.md

```markdown
# <Feature Name>

## Overview

<2-3 sentence elevator pitch: what this feature does and why it matters. Written so anyone in the company would understand it.>

## Problem Statement

<What pain, friction, or gap exists today that this feature addresses. Be specific: who is affected, how often, what's the consequence of not solving it.>

## How It Works Today

<Describe the current user experience relevant to this feature. What do users do today? What tools, screens, or workarounds do they use? What's the starting point before this feature exists? If this is a brand-new capability with no existing workflow, state that clearly.>

## Users & Personas

### <Persona Name> (e.g., "Visitor", "Front Desk Agent", "Host")

| Attribute | Description |
|-----------|-------------|
| Who they are | <brief description of this person's role and context> |
| What they care about | <their priorities, goals, and frustrations> |
| How they interact | <where and how they use the system: mobile, desktop, kiosk, etc.> |

<Repeat ### block for each persona involved in this feature>

## Scope

### In Scope

- <capability that IS included in this feature>
- <capability that IS included in this feature>

### Out of Scope

- <capability that is explicitly NOT included> — <brief reason why>
- <capability that is explicitly NOT included> — <brief reason why>

## User Stories

### <User Story Title>

**As a** <persona>, **I want** <capability>, **so that** <benefit>.

**Acceptance Criteria:**

- [ ] <specific, testable condition that must be true for this story to be complete>
- [ ] <specific, testable condition>
- [ ] <specific, testable condition>

<Repeat ### block for each user story>

## User Flows

### <Flow Name> (e.g., "Visitor Self Check-in", "Host Approval")

**Actor:** <persona>
**Trigger:** <what starts this flow — e.g., "Visitor taps the check-in link in their email">

**Steps:**

1. <what the user sees or does>
2. <what happens next — from the user's perspective>
3. <next step>
4. <...continue until the flow is complete>

**Flow Diagram:**

<Mermaid flowchart showing the flow visually. Use flowchart LR or TD.>

<Repeat ### block for each major user flow>

## Screen Descriptions

### <Screen Name> (e.g., "Check-in Welcome Screen")

**Who sees it:** <persona>
**When:** <what triggers this screen — e.g., "After tapping the check-in link">

**What's on the screen:**

- <element: e.g., "Welcome message with the host's name and meeting details">
- <element: e.g., "A 'Check In' button">
- <element: e.g., "A link to 'Need help?'">

**What the user can do:**

- <action> → <what happens next>
- <action> → <what happens next>

<Repeat ### block for each key screen in the feature>

## Notifications & Communications

| Event | Who Gets Notified | Channel | Content Summary |
|-------|-------------------|---------|-----------------|
| <what triggers the notification — e.g., "Visitor checks in"> | <persona — e.g., "Host"> | <email / in-app / push / SMS> | <what the message says — e.g., "Your visitor John Smith has arrived at the front desk"> |
| <event> | <recipient> | <channel> | <content> |

<Include every notification the feature should send. Cover: who sends it (system vs. user), who receives it, what channel, what content, and any conditions (e.g., "only if host opted in"). If the feature doesn't need notifications, state "No notifications required for this feature." and explain why.>

## Configuration & Settings

| Setting | Who Controls It | Options | Default |
|---------|----------------|---------|---------|
| <what can be configured — e.g., "Check-in time window"> | <admin / system property> | <allowed values — e.g., "15, 30, 60 minutes before scheduled arrival"> | <default value — e.g., "30 minutes"> |
| <setting> | <who> | <options> | <default> |

<Capture every product decision that should be tunable by an admin rather than hardcoded. If no configurable settings are needed, state "No configurable settings for this feature." and explain why.>

## Edge Cases & Error States

| Scenario | What Happens |
|----------|-------------|
| <unusual situation — e.g., "Visitor clicks check-in link after the meeting ended"> | <how the system should respond — e.g., "Show a friendly message: 'This meeting has already ended. Please contact your host.'"> |
| <unusual situation> | <response> |
| <unusual situation> | <response> |

<Cover at minimum: first-time use, invalid/missing input, expired/stale states, concurrent actions, interrupted flows, permission issues.>

## Success Metrics

| Metric | Target |
|--------|--------|
| <what to measure — e.g., "Visitor check-in completion rate"> | <expected outcome — e.g., "90% of visitors complete self check-in without help"> |
| <what to measure> | <target> |

## Open Questions

| Question | Context | Impact |
|----------|---------|--------|
| <unresolved question — e.g., "Should visitors be able to check in more than 30 minutes early?"> | <why it matters — e.g., "Some visitors arrive very early for back-to-back meetings"> | <what it blocks — e.g., "Affects the check-in time window logic"> |
| <question> | <context> | <impact> |

<Only include genuine open questions that need stakeholder decisions. Do NOT include questions you can answer from the brainstorming session.>
```

---

## Writing Guidelines

When filling in this template:

- **Write for two audiences**: the product team (who validates it) and the architect (who builds from it)
- **Be specific, not vague**: "Show an error message" is bad. "Show: 'This meeting has already ended. Please contact your host.'" is good
- **Every acceptance criterion must be testable**: if you can't write a yes/no test for it, rewrite it
- **User flows describe the user's experience**, not system behavior. "The user sees a confirmation screen" not "The system saves the record and returns a 200"
- **Screen descriptions are not wireframes** — they describe what's present and what the user can do, not pixel-level layout
- **Edge cases should cover**: first-time use, empty states, expired/stale data, invalid input, concurrent actions, interrupted flows, and permission boundaries

---

## index.html

Generate a self-contained HTML file that renders the specification for stakeholder review. Convert all markdown content from `specification.md` into the HTML sections below. Mermaid code blocks become `<div class="mermaid">` blocks.

Follow this template exactly:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Specification — FEATURE_NAME</title>
  <style>
    :root {
      --bg: #1a1a2e;
      --sidebar-bg: #252542;
      --border: #3d3d5c;
      --text: #e0e0e0;
      --text-muted: #888;
      --accent: #6c63ff;
      --accent-hover: #5a52d5;
      --card-bg: #2a2a4a;
      --table-header: #1e1e3a;
      --table-stripe: #252545;
      --code-bg: #1e1e3a;
      --success: #4caf50;
      --warning: #ff9800;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
    }

    .layout { display: flex; height: 100vh; }

    /* --- Sidebar --- */
    .sidebar {
      width: 260px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      padding: 20px 0;
      overflow-y: auto;
      flex-shrink: 0;
    }

    .sidebar h1 {
      font-size: 16px;
      padding: 0 20px 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }

    .sidebar nav a {
      display: block;
      padding: 8px 20px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      border-left: 3px solid transparent;
    }

    .sidebar nav a:hover {
      color: var(--text);
      background: rgba(108, 99, 255, 0.1);
      border-left-color: var(--accent);
    }

    .sidebar .nav-section {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 16px 20px 4px;
      letter-spacing: 0.05em;
    }

    /* --- Main content --- */
    .main {
      flex: 1;
      overflow-y: auto;
      scroll-behavior: smooth;
      padding: 32px 48px;
      max-width: 960px;
    }

    .section { padding-bottom: 48px; border-bottom: 1px solid var(--border); margin-bottom: 32px; }
    .section:last-child { border-bottom: none; }

    h2 { font-size: 22px; margin-bottom: 8px; scroll-margin-top: 16px; }
    h3 { font-size: 16px; margin: 24px 0 8px; color: var(--accent); }
    h4 { font-size: 14px; margin: 16px 0 4px; }

    p, li { margin: 8px 0; }
    ul, ol { padding-left: 20px; }

    /* --- Tables --- */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 13px;
    }

    th {
      background: var(--table-header);
      text-align: left;
      padding: 8px 12px;
      font-weight: 600;
      border-bottom: 2px solid var(--border);
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
    }

    tr:nth-child(even) td { background: var(--table-stripe); }

    /* --- Code --- */
    code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      font-family: 'SF Mono', Consolas, monospace;
    }

    /* --- Diagrams --- */
    .mermaid {
      background: var(--card-bg);
      border-radius: 8px;
      padding: 20px;
      margin: 16px 0;
      text-align: center;
    }

    /* --- Cards --- */
    .card {
      background: var(--card-bg);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 12px 0;
    }

    /* --- Story cards --- */
    .story-card {
      background: var(--card-bg);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 12px 0;
      border-left: 3px solid var(--accent);
    }

    .story-card strong { color: var(--accent); }

    .checklist { list-style: none; padding-left: 0; }
    .checklist li { padding: 4px 0; font-size: 13px; }
    .checklist li::before { content: '☐ '; color: var(--text-muted); }

    /* --- Screen description cards --- */
    .screen-card {
      background: var(--card-bg);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 12px 0;
    }

    .screen-meta {
      display: grid;
      grid-template-columns: 100px 1fr;
      gap: 4px 16px;
      font-size: 13px;
      margin-bottom: 12px;
    }

    .screen-meta dt { color: var(--text-muted); }
    .screen-meta dd { font-weight: 500; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <h1>FEATURE_NAME</h1>
      <nav>
        <div class="nav-section">Specification</div>
        <a href="#overview">Overview</a>
        <a href="#problem">Problem Statement</a>
        <a href="#today">How It Works Today</a>
        <a href="#personas">Users & Personas</a>
        <a href="#scope">Scope</a>

        <div class="nav-section">Details</div>
        <a href="#stories">User Stories</a>
        <a href="#flows">User Flows</a>
        <a href="#screens">Screen Descriptions</a>
        <a href="#notifications">Notifications</a>
        <a href="#configuration">Configuration</a>

        <div class="nav-section">Analysis</div>
        <a href="#edge-cases">Edge Cases</a>
        <a href="#metrics">Success Metrics</a>
        <a href="#questions">Open Questions</a>
      </nav>
    </aside>

    <main class="main">

      <!-- ==================== OVERVIEW ==================== -->
      <div id="overview" class="section">
        <h2>Overview</h2>
        <!-- Convert the Overview section from specification.md -->
      </div>

      <!-- ==================== PROBLEM STATEMENT ==================== -->
      <div id="problem" class="section">
        <h2>Problem Statement</h2>
        <!-- Convert the Problem Statement section from specification.md -->
      </div>

      <!-- ==================== HOW IT WORKS TODAY ==================== -->
      <div id="today" class="section">
        <h2>How It Works Today</h2>
        <!-- Convert the How It Works Today section from specification.md -->
      </div>

      <!-- ==================== USERS & PERSONAS ==================== -->
      <div id="personas" class="section">
        <h2>Users & Personas</h2>
        <!-- For each persona, create an h3 heading and a table with
             Who they are / What they care about / How they interact -->
      </div>

      <!-- ==================== SCOPE ==================== -->
      <div id="scope" class="section">
        <h2>Scope</h2>
        <!-- In Scope as h3 with bullet list, Out of Scope as h3 with bullet list -->
      </div>

      <!-- ==================== USER STORIES ==================== -->
      <div id="stories" class="section">
        <h2>User Stories</h2>
        <!-- For each story, use a .story-card div:
             <div class="story-card">
               <h3>Story Title</h3>
               <p><strong>As a</strong> persona, <strong>I want</strong> capability, <strong>so that</strong> benefit.</p>
               <h4>Acceptance Criteria</h4>
               <ul class="checklist"><li>criterion</li></ul>
             </div>
        -->
      </div>

      <!-- ==================== USER FLOWS ==================== -->
      <div id="flows" class="section">
        <h2>User Flows</h2>
        <!-- For each flow:
             h3 with flow name, actor/trigger metadata,
             numbered step list, then mermaid diagram:
             <div class="mermaid">
               flowchart TD
                 A[Step] --> B[Step]
             </div>
        -->
      </div>

      <!-- ==================== SCREEN DESCRIPTIONS ==================== -->
      <div id="screens" class="section">
        <h2>Screen Descriptions</h2>
        <!-- For each screen, use a .screen-card div:
             <div class="screen-card">
               <h3>Screen Name</h3>
               <dl class="screen-meta">
                 <dt>Who sees it</dt><dd>persona</dd>
                 <dt>When</dt><dd>trigger</dd>
               </dl>
               <h4>What's on the screen</h4>
               <ul><li>element</li></ul>
               <h4>What the user can do</h4>
               <ul><li>action → result</li></ul>
             </div>
        -->
      </div>

      <!-- ==================== NOTIFICATIONS ==================== -->
      <div id="notifications" class="section">
        <h2>Notifications & Communications</h2>
        <!-- Table with Event / Who Gets Notified / Channel / Content Summary columns -->
      </div>

      <!-- ==================== CONFIGURATION ==================== -->
      <div id="configuration" class="section">
        <h2>Configuration & Settings</h2>
        <!-- Table with Setting / Who Controls It / Options / Default columns -->
      </div>

      <!-- ==================== EDGE CASES ==================== -->
      <div id="edge-cases" class="section">
        <h2>Edge Cases & Error States</h2>
        <!-- Table with Scenario / What Happens columns -->
      </div>

      <!-- ==================== SUCCESS METRICS ==================== -->
      <div id="metrics" class="section">
        <h2>Success Metrics</h2>
        <!-- Table with Metric / Target columns -->
      </div>

      <!-- ==================== OPEN QUESTIONS ==================== -->
      <div id="questions" class="section">
        <h2>Open Questions</h2>
        <!-- Table with Question / Context / Impact columns -->
      </div>

    </main>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });

    // Render all mermaid diagrams
    document.addEventListener('DOMContentLoaded', async () => {
      const elements = document.querySelectorAll('.mermaid');
      for (const el of elements) {
        const { svg } = await mermaid.render('m-' + Math.random().toString(36).slice(2), el.textContent);
        el.innerHTML = svg;
      }
    });
  </script>
</body>
</html>
```
