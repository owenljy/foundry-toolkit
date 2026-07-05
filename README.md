# foundry-suite — Claude's ServiceNow toolkit, built around Fluent (`now-sdk`)

A Claude Code **plugin marketplace** for working on ServiceNow the Fluent way. It
ships **two plugins** you can install separately or together, and it grows over
time.

| Plugin | What it is |
|---|---|
| **[`now-mcp`](plugins/now-mcp/README.md)** | A small, trustworthy, **Fluent-native** [MCP](https://modelcontextprotocol.io) server that lets Claude **operate a running ServiceNow instance** — read/write runtime data, inspect schema, run scripts, manage attachments. Carries the `sn-docs-search` skill and a SessionStart hook that injects the standing Fluent-workflow rules into a Fluent project's `CLAUDE.md`. |
| **[`aia-toolkit`](plugins/aia-toolkit/README.md)** | Skills for the full **ServiceNow AI Agent lifecycle** — build an agent as now-sdk Fluent, audit it against deployment guardrails, build eval datasets, set up the platform eval pipeline, and analyze runtime execution traces. Skills-only; pairs with `now-mcp` for live-instance reads. |

## The idea in one paragraph

Three layers, each with one job: **Fluent (`now-sdk`) authors** the application
(tables, business rules, workflows) as source code and deploys it; **`now-mcp`
operates** the running instance (query/aggregate data, read schema, write data
rows, run server-side scripts, manage attachments); **skills orchestrate** the
two into workflows. The line that keeps them apart: **data rows are runtime →
MCP; config/metadata is the app's definition → Fluent source.** That's why the
MCP writes an incident but never a business rule.

![SDK authors the application, MCP operates the running instance, Skills orchestrate the two — with a "where does it go?" guide](docs/three-layers.png)

---

## Install

The suite ships as Claude Code **plugins** from the `foundry-suite`
marketplace — install from git, no manual build. Add the marketplace once, then
install whichever plugins you want:

```
/plugin marketplace add <REPO_URL>
/plugin install now-mcp@foundry-suite      # the MCP server + Fluent skills/hook
/plugin install aia-toolkit@foundry-suite  # the AI Agent lifecycle skills (optional)
/reload-plugins
```

Install `now-mcp` alone for the data/schema/script tools; add `aia-toolkit` when
you work on ServiceNow AI Agents. `aia-toolkit` is skills-only (no setup form)
and uses `now-mcp` for its live-instance reads, so installing both is the usual
setup.

For per-plugin setup, tools, configuration, and safety details, see each
plugin's README:

- **[`plugins/now-mcp/README.md`](plugins/now-mcp/README.md)** — connection setup
  (single-instance form or YAML), the full tool surface, now-sdk pairing, and the
  safety model.
- **[`plugins/aia-toolkit/README.md`](plugins/aia-toolkit/README.md)** — the five
  AI Agent skills, where to start, and the eval flow.

---

## Repository layout

```
foundry-suite/
├── .claude-plugin/marketplace.json   # the marketplace manifest
├── plugins/
│   ├── now-mcp/                       # the MCP server plugin (self-contained)
│   └── aia-toolkit/                   # the AI Agent skills plugin
├── docs/
├── LICENSE
└── README.md                         # you are here
```
