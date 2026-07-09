# Table Design

## When to use this doc

Load this when creating new tables (dictionary XML), adding fields, defining relationships, setting up choice fields, indexes, or reference qualifiers.

## Table Definition Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<database>
    <element name="sn_myapp_record" label="Record" extends="sys_metadata"
             audit="true" attributes="update_synch" type="collection">
        <!-- Field definitions -->
        <element name="field_name" type="field_type" ... />
        
        <!-- Index definitions -->
        <index name="index_name">
            <element name="field_name" />
        </index>
    </element>
</database>
```

File location: `dictionary/{table_name}.xml`

### Table Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Internal table name (prefixed with scope) |
| `label` | Yes | Display name in UI |
| `type` | Yes | Always `collection` |
| `extends` | No | Parent table for inheritance |
| `audit` | No | Enable audit logging |
| `attributes` | No | Comma-separated key=value pairs |

### Special Parent Tables

| Parent | Purpose |
|--------|---------|
| `sys_metadata` | Configuration table with update set tracking |
| `task` | Task-based workflow table (inherits task fields) |

## Field Types

### Basic Types

| Type | Description | Typical `max_length` |
|------|-------------|---------------------|
| `string` | Text field | `80`, `255`, `4000` |
| `integer` | Whole number | — |
| `boolean` | True/false | — |
| `float` / `decimal` | Decimal number | — |
| `translated_text` | Translatable text | `80`, `4000` |

### Date/Time Types

| Type | Description |
|------|-------------|
| `glide_date_time` | Date and time |
| `glide_date` | Date only |
| `glide_time` | Time only |

### Reference Types

| Type | Description |
|------|-------------|
| `reference` | Foreign key (requires `reference` attribute) |
| `glide_list` | Multi-value reference |
| `document_id` | Dynamic table reference |

### Special Types

| Type | Description |
|------|-------------|
| `sys_class_name` | Stores table name for polymorphism |
| `domain_id` | Domain separation field |
| `table_name` | Table picker |
| `field_name` | Field picker (use with `dependent`) |
| `conditions` | Condition builder |
| `journal` / `journal_input` | Activity stream |
| `user_image` | Image with preview |
| `json` | JSON data |
| `email` | Email address |

## Reference Fields

### Basic

```xml
<element name="user" type="reference" reference="sys_user" />
```

### Static Reference Qualifier

```xml
<element name="shift" type="reference" reference="sn_wsd_core_shift" 
         reference_qual="active=true^EQ" />
```

### JavaScript Reference Qualifier

```xml
<element name="floor" type="reference" reference="sn_wsd_core_floor" 
         reference_qual="javascript:'building='+current.building" />
```

### Cascade Rules

```xml
<element name="parent" type="reference" reference="other_table" 
         reference_cascade_rule="delete" />
```

| Value | Behavior |
|-------|----------|
| `cascade` / `delete` | Delete this record when referenced record is deleted |
| `restrict` | Prevent deletion of referenced record |

## Choice Fields

### String Choice

```xml
<element name="state" type="string" choice="3" default="draft">
    <choice>
        <element sequence="10" value="draft" label="Draft" />
        <element sequence="20" value="active" label="Active" />
        <element sequence="30" value="complete" label="Complete" />
    </choice>
</element>
```

### Integer Choice

```xml
<element name="priority" type="integer" choice="3" default="2">
    <choice>
        <element sequence="10" value="1" label="High" />
        <element sequence="20" value="2" label="Medium" />
        <element sequence="30" value="3" label="Low" />
    </choice>
</element>
```

### Dependent Choice

```xml
<element name="subtype" type="string" dependent="type" choice="3">
    <choice>
        <element sequence="10" value="a" label="Option A" dependent_value="type1" />
        <element sequence="20" value="b" label="Option B" dependent_value="type2" />
    </choice>
</element>
```

Choice attribute values: `1` = dropdown no default, `3` = dropdown with default.

## Indexes

### Single Column

```xml
<index name="index_active">
    <element name="active" />
</index>
```

### Composite

```xml
<index name="index_state_active">
    <element name="state" />
    <element name="active" />
</index>
```

Index fields you frequently query on or use in filter conditions.

## Junction Tables (Many-to-Many)

```xml
<element name="sn_myapp_user_role" label="User Role Assignment" 
         audit="true" type="collection">
    <element name="user" type="reference" reference="sys_user" mtom="Roles" 
             display="true" mandatory="true" />
    <element name="role" type="reference" reference="sn_myapp_role" mtom="Users" 
             mandatory="true" />
    <element name="active" type="boolean" default="true" />
    
    <index name="index_user_role">
        <element name="user" />
        <element name="role" />
    </index>
</element>
```

## Auto-Number Configuration

For fields using `javascript:global.getNextObjNumberPadded()`, create a `sys_number` record in `update/`:

```xml
<sys_number action="INSERT_OR_UPDATE">
  <category display_value="" name="sn_myapp_request">sn_myapp_request</category>
  <maximum_digits>7</maximum_digits>
  <number>1000</number>
  <prefix>REQ</prefix>
</sys_number>
```

This produces numbers like `REQ0001000`, `REQ0001001`, etc.

## Domain Separation

Always include on most tables:

```xml
<element name="sys_domain" type="domain_id" max_length="medium" default="global" 
         label="Domain" plural="Domains" />
```

## Condition Builder Fields

### Dependent on Table Field

```xml
<element name="table" type="table_name" />
<element name="conditions" type="conditions" use_dependent_field="true" dependent="table" />
```

### Static Dependent

```xml
<element name="filter" type="conditions" attributes="staticDependent=cmn_location" />
```

## Encoded Query Syntax

| Symbol | Meaning |
|--------|---------|
| `^` | AND separator |
| `^OR` | OR separator |
| `^EQ` | End query marker |
| `INSTANCEOF` | Class hierarchy check |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Missing `type="collection"` on table | Required for all table definitions |
| Reference field without `reference` attribute | Must specify target table |
| No index on frequently queried fields | Add indexes for query performance |
| Missing domain_id field | Include for domain separation support |
| Choice sequences not spaced | Use increments of 10 for insertion flexibility |

## Task Types This Doc Supports

- Creating new tables and fields
- Adding reference fields and relationships
- Setting up choice fields with sequences
- Defining indexes for performance
- Building junction tables for M2M relationships
- Auto-number configuration
- Code reviews of dictionary XML
