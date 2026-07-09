# ACL Patterns

## When to use this doc

Load this when designing role hierarchies, creating ACLs, debugging access issues, or reviewing security configurations for ServiceNow applications.

## Role Naming Convention

```
{scope}.{suffix}
```

### Standard Suffixes

| Suffix | Purpose | Example |
|--------|---------|---------|
| `admin` | Full administrative access | `sn_myapp.admin` |
| `user` | Standard user access | `sn_myapp.user` |
| `viewer` | Read-only access | `sn_myapp.viewer` |
| `operator` | Operational tasks | `sn_myapp.operator` |

## Role Hierarchy (Containment)

Use containment to build role inheritance — users with parent role automatically get child roles:

```
sn_myapp.admin
└── contains: sn_myapp.user
    └── contains: sn_myapp.viewer
```

This means: admin users automatically have user and viewer permissions. Only need to assign ACLs at the minimum required level.

## ACL Operations

| Operation | Display Value | Value |
|-----------|---------------|-------|
| read | read | `read` |
| write | write | `write` |
| create | create | `create` |
| delete | delete | `delete` |
| report_view | report_view | `0997ab83733303005978e4b9cdf6a7b9` |

**Note**: `report_view` uses a sys_id reference instead of a string value.

## ACL Types

### Record-Level ACL

Controls access to entire records:

```xml
<sys_security_acl action="INSERT_OR_UPDATE">
  <n>sn_myapp_task</n>
  <operation display_value="read">read</operation>
  <type display_value="record">record</type>
  <admin_overrides>true</admin_overrides>
</sys_security_acl>
```

### Field-Level ACL

Controls access to specific fields:

```xml
<sys_security_acl action="INSERT_OR_UPDATE">
  <n>sn_myapp_task.sensitive_field</n>
  <operation display_value="write">write</operation>
  <type display_value="field">field</type>
</sys_security_acl>
```

### Conditional ACL

Only applies when condition matches:

```xml
<condition>active=true</condition>
```

### Script-Based ACL (Owner Only Pattern)

```xml
<advanced>true</advanced>
<script>answer = current.assigned_to == gs.getUserID();</script>
```

## Securing a New Table: Complete Recipe

### Step 1: Create Roles

Create `sys_user_role` records for each role tier.

### Step 2: Create Role Containment

Create `sys_user_role_contains` records for the hierarchy:
- `admin` contains `user`
- `user` contains `viewer`

### Step 3: Create ACLs

For each table, create ACLs for each operation (read, write, create, delete):

```xml
<sys_security_acl action="INSERT_OR_UPDATE">
  <active>true</active>
  <admin_overrides>true</admin_overrides>
  <n>sn_myapp_task</n>
  <operation display_value="read">read</operation>
  <type display_value="record">record</type>
</sys_security_acl>
```

### Step 4: Link ACLs to Roles

Create `sys_security_acl_role` records linking each ACL to the required role:

```xml
<sys_security_acl_role action="INSERT_OR_UPDATE">
  <sys_security_acl display_value="">{acl_sys_id}</sys_security_acl>
  <sys_user_role display_value="sn_myapp.user" name="sn_myapp.user">{role_sys_id}</sys_user_role>
</sys_security_acl_role>
```

## Common Access Patterns

| Pattern | Read | Write | Create | Delete |
|---------|------|-------|--------|--------|
| Admin-only table | admin | admin | admin | admin |
| User-managed table | user | user | user | admin |
| Read-many write-few | viewer | user | user | admin |
| Owner-editable | viewer | owner (script) | user | admin |

## admin_overrides

When `admin_overrides=true` (default), system administrators bypass this ACL entirely. Set to `false` only when you want to restrict even admins (rare).

## Debugging Access Issues

1. Impersonate the affected user
2. Check `System Diagnostics > Session Debug > Security`
3. Look for which ACL evaluated and what `answer` was
4. Verify role assignment: user has the role, containment chain is correct
5. Check for conflicting ACLs — most restrictive wins at same level

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Creating circular role containment | A contains B, B contains A — breaks role evaluation |
| Missing ACL for a table | Every custom table needs at least read/write/create/delete ACLs |
| Over-relying on admin override | Don't use admin override as a substitute for proper ACL design |
| Containing roles from other scopes without reason | Only contain cross-scope roles when there's a clear dependency |
| Not testing with non-admin user | Always test ACLs by impersonating each role tier |

## Task Types This Doc Supports

- Designing role hierarchies for new applications
- Creating ACLs for new tables
- Building field-level security
- Writing script-based ACLs (owner-only, conditional)
- Debugging access issues
- Security audits and code reviews
