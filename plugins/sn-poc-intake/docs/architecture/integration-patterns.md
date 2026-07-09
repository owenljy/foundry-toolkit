# Integration Patterns

Reference for event-driven architectures, email notifications, mail scripts, and inbound/outbound messaging in ServiceNow scoped applications.

## When to Use This Doc

Load this doc when:
- Building event-driven workflows (events, script actions, notifications)
- Creating email notification systems (event-based or record-based)
- Writing mail scripts for dynamic email content
- Processing inbound emails to create or update records
- Setting up notification categories for subscription management
- Reviewing integration code that touches any of the above

For outbound REST/SOAP/Import Set patterns, see the TODO section at the end.

---

## Event Architecture

ServiceNow's event system decouples record changes from downstream actions:

```
Record Change -> Business Rule -> gs.eventQueue() -> Event -> Notification / Script Action
```

### Event Registration

Events must be registered in `sysevent_register` before they can trigger notifications or script actions. File location: `update/sysevent_register_{sys_id}.xml`.

**Naming convention:**

```
{scope}.{action}_{subject}
```

Examples:
- `sn_wsd_visitor.notify_created`
- `sn_wsd_visitor.invitation_cancelled`
- `sn_myapp.magic_link`

Key fields: `event_name` (full name), `suffix` (without scope prefix), `table` (associated table), `priority` (100 = normal).

### Firing Events from Code

Call `gs.eventQueue()` from a business rule (typically after insert/update):

```javascript
// Minimal -- no parameters
gs.eventQueue('sn_myapp.record_created', current, '', '');

// With parameters
gs.eventQueue('sn_myapp.record_created', current,
    current.assigned_to,          // event.parm1 (sys_id of a user)
    current.getValue('priority')  // event.parm2 (string value)
);
```

### Event Parameters (parm1 and parm2)

`parm1` and `parm2` are string fields, commonly holding sys_ids or short values. They are accessible in notifications, mail scripts, and script actions as `event.parm1` / `event.parm2`. When parm1 contains a user sys_id, it can serve as the notification recipient. You cannot dot-walk from parm values in templates -- use mail scripts instead.

---

## Email Notifications

File location: `update/sysevent_email_action_{sys_id}.xml`. Two generation types: **event-based** (`generation_type=event`, triggered by `gs.eventQueue()`) and **record-based** (`generation_type=engine`, triggered by record insert/update). Event-based is preferred for custom notifications.

### Recipients

| Field | Description | Example |
|-------|-------------|---------|
| `recipient_fields` | Dot-walk field path to a user reference | `source_visit.host` |
| `item` | Event parameter as recipient | `event.parm1` or `event.parm2` |
| `recipient_users` | Hardcoded user sys_ids | |
| `recipient_groups` | Group sys_ids | |
| `send_self` | Include the user who triggered the event | `true` / `false` |

### CRITICAL: event_parm Flags

When using `event.parm1` or `event.parm2` as the **recipient** via the `item` field, you **MUST** set the corresponding flag to `true`:

| Recipient | Required Flag |
|-----------|---------------|
| `event.parm1` | `<event_parm_1>true</event_parm_1>` |
| `event.parm2` | `<event_parm_2>true</event_parm_2>` |

**If the flag is `false`, NO EMAIL WILL BE SENT. This is a silent failure -- no error, no log, just nothing.**

Exception: when using `recipient_fields` to specify the recipient, both flags can be `false`.

### Template Syntax

Use `${}` syntax in `subject` and `message_html`: `${field_name}`, `${reference.field}`, `${mail_script:name}`, `${gs.getProperty('key')}`.

### Content Types

`text/html` (standard), `multipart/mixed` (attachments), `text/plain` (plain text).

### Record-Based Triggers

For `generation_type=engine`: set `action_insert` / `action_update` to fire on insert/update. Use `affected_field_on_event` to restrict to a specific field change.

### Advanced Conditions

Use `advanced_condition` for script-based filtering. Set `answer = true/false`:

```javascript
var isPolicyReminder = WSDVMUtils.safeBool(event.parm1);
answer = isPolicyReminder;
```

---

## Mail Scripts

File location: `update/sys_script_email_{sys_id}.xml`. Referenced in notification templates as `${mail_script:script_name}`.

### Function Signature

```javascript
(function runMailScript( /* GlideRecord */ current, /* TemplatePrinter */ template,
    /* Optional EmailOutbound */ email, /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */ event) {

    // Your logic here
    template.print('output text or HTML');

})(current, template, email, email_action, event);
```

### Available Variables

| Variable | Type | Description |
|----------|------|-------------|
| `current` | GlideRecord | The triggering record |
| `template` | TemplatePrinter | Call `template.print()` to emit output |
| `email` | EmailOutbound | The outgoing email object (optional) |
| `email_action` | GlideRecord | The notification record (optional) |
| `event` | GlideRecord | The event record, if event-based (optional) |

### Common Patterns

All examples below go inside the `runMailScript` IIFE shown above.

**Getting a user from event.parm1:**
```javascript
var userGr = new GlideRecord('sys_user');
if (userGr.get(event.parm1)) {
    template.print(userGr.getValue('first_name'));
}
```

**Building a link:**
```javascript
var baseUrl = gs.getProperty('glide.servlet.uri');
var link = baseUrl + '/nav_to.do?uri=my_table.do?sys_id=' + current.getUniqueValue();
template.print('<a href="' + link + '">View Record</a>');
```

**Looping related records:**
```javascript
var gr = new GlideRecord('related_table');
gr.addQuery('parent', current.getUniqueValue());
gr.query();
template.print('<ul>');
while (gr.next()) {
    template.print('<li>' + gr.getDisplayValue('name') + '</li>');
}
template.print('</ul>');
```

**Conditional content:**
```javascript
if (current.getValue('vip') == 'true') {
    template.print('<span class="vip-badge">VIP Guest</span>');
}
```

---

## Script Actions

Server-side code triggered by events, without sending email. File location: `update/sysevent_script_action_{sys_id}.xml`.

Use script actions when an event should trigger logic (updating records, calling APIs, logging) rather than sending a notification.

### Available Variables

| Variable | Description |
|----------|-------------|
| `event` | The event GlideRecord |
| `current` | The record that triggered the event |
| `event.parm1` | First parameter from `gs.eventQueue()` |
| `event.parm2` | Second parameter from `gs.eventQueue()` |

### Example

```javascript
// Script action: Process visitor arrival
var visitorId = event.parm1;
var registrationGr = current;

new WSDVMVisitorService().processArrival(visitorId);
gs.info('Processed visitor arrival: ' + visitorId);
```

Key fields: `event_name` (which event triggers it), `order` (execution order, lower = first), `condition_script` (optional guard).

---

## Inbound Email Actions

Process incoming emails to create or update records. File location: `update/sysevent_in_email_action_{sys_id}.xml`.

Action types: `new` (create record) or `reply` (update existing, matched by watermark). Email object properties: `email.subject`, `email.body_text`, `email.body` (HTML), `email.from`, `email.to`, `email.cc`, `email.importance`.

### Example Script

```javascript
// Inbound email action: Create incident from email
current.short_description = email.subject;
current.description = email.body_text;
current.caller_id = email.from;

if (email.subject.toLowerCase().indexOf('urgent') > -1) {
    current.priority = 1;
}
```

Key fields: `target_table` (table to create/update), `order` (processing order), `stop_processing` (prevent other actions from running), `condition` (when to apply).

---

## Notification Categories

Group notifications for subscription management via `sys_notification_category`. File: `update/sys_notification_category_{sys_id}.xml`. Key fields: `name`, `description`, `subscribable` (allows user opt-in/out). Reference in notification XML: `<category display_value="Name">{sys_id}</category>`.

---

## event.parm Limitation

**You cannot dot-walk from `event.parm1` or `event.parm2` in notification templates.** These are plain strings, not GlideElement references.

For example, `${event.parm1.first_name}` will NOT work -- it renders blank or errors. Instead, write a mail script that calls `new GlideRecord('sys_user').get(event.parm1)` and prints the field value via `template.print()`. See the "Getting a user from event.parm1" pattern in the Mail Scripts section above.

---

## Common Mistakes

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| `event_parm_1` set to `false` when `item=event.parm1` | Email silently never sends | Set `event_parm_1` to `true` |
| Dot-walking `event.parm1.field` in template | Renders blank or errors | Use a mail script to resolve the reference |
| Forgetting to register the event in `sysevent_register` | Event fires but nothing listens | Create the registration record |
| Using CDATA in `subject` field | Subject renders with CDATA tags | Subject is plain text with `${}` variables, no CDATA |
| Missing CDATA in `message_html` | HTML entities break or get escaped | Always wrap `message_html` in `<![CDATA[...]]>` |
| Firing event in a "before" business rule | `current` may not have sys_id yet | Fire events in "after" business rules |
| Not setting `send_self=true` | Triggered user does not receive email | Set `send_self` to `true` if they should get it |
| Hardcoding instance URL in mail scripts | Breaks across instances | Use `gs.getProperty('glide.servlet.uri')` |

---

## Task Types This Doc Supports

- Building event-driven architectures (event registration, firing, listeners)
- Creating email notification systems (event-based and record-based)
- Writing mail scripts for dynamic email content
- Building script actions for non-email event handling
- Processing inbound emails to create/update records
- Setting up notification categories and subscriptions
- Code reviews of notification and integration code

---

## TODO: Future Content

The following integration patterns are not yet documented. Expand this section as patterns are established:

- REST Message (outbound) configuration and error handling
- SOAP Message patterns
- Import Set patterns and transform maps
- MID Server usage for on-premise integrations
- Integration Hub / Spoke patterns
- Credential management for external services
- Pagination handling for REST integrations
- Retry strategies and circuit breaker patterns for external calls
