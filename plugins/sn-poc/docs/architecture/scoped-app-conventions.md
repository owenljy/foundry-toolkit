# Scoped App Conventions

## When to use this doc

Load this when working with ServiceNow scoped applications — understanding project structure, scope rules, file organization, and cross-scope access patterns.

## Project Structure

```
my-app/
├── plugin.properties           # App metadata — READ THIS FIRST
├── package.json                # NPM config for tests/linting
├── src/main/plugins/com.{scope}/
│   ├── dictionary/             # Table definitions (local-first)
│   ├── update/                 # All other records (MCP-first)
│   ├── if/                     # Conditional records (dependency-gated)
│   │   └── {dep_plugin}/update/  # Applied only when dep plugin is installed
│   └── unload.demo/            # Demo data
└── src/test/js/                # Unit tests
```

### plugin.properties

Contains critical app metadata:

| Property | Description | Example |
|----------|-------------|---------|
| `plugin.name` | App display name | `Visitor Management` |
| `plugin.scope_name` | Scope identifier | `sn_wsd_visitor` |
| `plugin.scope_sys_id` | App sys_id | `abc123...` |
| `plugin.dir` | Plugin directory | `com.sn_wsd_visitor` |

**Always read plugin.properties first** — use actual values, never placeholders.

## Source of Truth Rules

| Record Type | Source of Truth | Why |
|-------------|----------------|-----|
| Dictionary (tables/fields) | **Local files** | Dictionary XML deploys from local via `deploy` |
| All other records | **MCP-first** | Created/updated via MCP, then synced locally |

## XML File Naming

```
{table}_{sys_id}.xml
```

Examples:
- `sys_script_include_abc123def456.xml`
- `sys_script_abc123def456.xml`
- `sys_security_acl_abc123def456.xml`

## XML Structure

All update records follow this pattern:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<record_update sys_domain="global" table="{table_name}">
  <{table_name} action="INSERT_OR_UPDATE">
    <!-- Record fields -->
    <sys_package display_value="{App Name}" source="{scope}">{app_sys_id}</sys_package>
    <sys_scope display_value="{App Name}">{app_sys_id}</sys_scope>
  </{table_name}>
</record_update>
```

### CDATA Rules

Script fields must be wrapped in CDATA:

```xml
<script><![CDATA[
// Your code here
]]></script>
```

Fields that use CDATA: `script`, `message`, `message_html`, `advanced_condition`, `client_script_v2`.

Fields that do NOT use CDATA: `condition`, `filter_condition`, `subject`, `description`.

## Cross-Scope Access

| Access Level | Visible To |
|-------------|------------|
| `package_private` | Only within the same scope |
| `public` | Accessible from any scope |

Script Includes that need to be called from other apps must be `public`. Client-callable Script Includes (GlideAjax) must also be `public`.

## Scope Prefix Convention

All custom artifacts use the scope as prefix:

| Artifact | Naming Pattern | Example |
|----------|---------------|---------|
| Tables | `{scope}_{name}` | `sn_wsd_visitor_visitor` |
| Roles | `{scope}.{suffix}` | `sn_wsd_visitor.admin` |
| Properties | `{scope}.{category}.{name}` | `sn_wsd_visitor.feature.enabled` |
| Events | `{scope}.{event}` | `sn_wsd_visitor.notify_created` |
| Script Includes | `{scope}.{ClassName}` (api_name) | `sn_wsd_visitor.VisitorService` |

## Files and Folders to Never Touch

- `target/` — Build artifacts only
- Files outside your app's plugin directory
- `sys_` prefixed system tables (unless creating ACLs/roles)

## Deploy Commands

| Command | Run From | Purpose |
|---------|----------|---------|
| `npm run test` | Project directory | Run unit tests |
| `npm run snlint-fix` | Project directory | Lint and auto-fix |
| `deploy` | Project root | Push dictionary changes to instance |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using placeholders in XML | Read plugin.properties, use actual sys_ids and scope names |
| Editing files in `target/` | Never — these are build artifacts |
| Missing `sys_scope` in XML records | Every record needs scope reference |
| Creating cross-scope dependencies without `public` access | Set `access=public` on shared Script Includes |
| Not deploying after dictionary changes | Run `deploy` to push local dictionary XML to instance |

## Task Types This Doc Supports

- Setting up new ServiceNow applications
- Understanding project file organization
- Working with cross-scope dependencies
- Creating XML records with correct scope references
- Code reviews checking scope conventions
