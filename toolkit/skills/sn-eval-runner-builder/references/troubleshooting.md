# Eval Runner Troubleshooting — Infra Checks & Stuck-Run Recovery

On-demand reference for `/sn-eval-runner-builder` → Troubleshooting Failed Eval Runs, steps 2
and 3. Step 1 (check the deployed runner) and the Common Failure Patterns table stay inline in
SKILL.md since they're short and apply to nearly every failure; reach for this file once you've
ruled out a stale/incorrect runner deploy and need to check instance infrastructure or unstick a
hung run.

---

## 2. Check instance infrastructure

If the runner code is correct, verify the instance has what it needs. If MCP is authenticated,
run these queries in parallel:

```
# Usecase exists
servicenow_query_records  tableName: sn_aia_usecase  query: name=<agent name>  limit: 1

# Published version exists
servicenow_query_records  tableName: sn_aia_version
  query: state=published^target_table=sn_aia_usecase^target_id=<usecase_sys_id>  limit: 1

# Dataset records exist
servicenow_query_records  tableName: aia_artifact_dataset
  query: unique_idSTARTSWITH<prefix>  limit: 5

# Auto Chat config exists
servicenow_query_records  tableName: auto_chat_configuration
  query: aia_usecase=<usecase_sys_id>  limit: 1

# REST endpoint is correct (not localhost)
servicenow_query_records  tableName: sys_rest_message  query: name=AutoChatBotToBot  limit: 1
```

If MCP is not authenticated, run this background script:

```js
(function() {
    var checks = {};
    var uc = new GlideRecord('sn_aia_usecase');
    uc.addQuery('name', '<agent display name>');
    uc.setLimit(1); uc.query();
    checks.usecase_found = uc.hasNext();
    if (uc.next()) {
        checks.usecase_id = uc.getUniqueValue();
        var ver = new GlideRecord('sn_aia_version');
        ver.addQuery('state', 'published');
        ver.addQuery('target_id', checks.usecase_id);
        ver.addQuery('target_table', 'sn_aia_usecase');
        ver.setLimit(1); ver.query();
        checks.version_found = ver.hasNext();
        var ac = new GlideRecord('auto_chat_configuration');
        ac.addQuery('aia_usecase', checks.usecase_id);
        ac.setLimit(1); ac.query();
        checks.autochat_config_found = ac.hasNext();
    }
    var ds = new GlideRecord('aia_artifact_dataset');
    ds.addQuery('unique_id', 'STARTSWITH', '<prefix>');
    ds.query();
    checks.dataset_count = ds.getRowCount();
    var rm = new GlideRecord('sys_rest_message');
    rm.addQuery('name', 'AutoChatBotToBot');
    rm.setLimit(1); rm.query();
    if (rm.next()) checks.rest_endpoint = rm.getValue('rest_endpoint');
    gs.info('=== EVAL DEBUG === ' + JSON.stringify(checks, null, 2));
})();
```

**Scope/ACL gotcha:** if `usecase_found: false` but the record exists, Global scope can't see
app-scoped records with `sys_policy: read`. Hardcode the usecase sys_id in the runner instead of
name-based lookup.

---

## 3. Stuck runs

When the dashboard shows "in progress" forever, use `EvalCleanup`:

```js
new sn_obs_aia_eval.EvalCleanup().run();                        // abort all stale runs
new sn_obs_aia_eval.EvalCleanup().run({ usecaseId: '<id>' });   // specific usecase
new sn_obs_aia_eval.EvalCleanup().run({ staleAfterHours: 2 });  // only runs older than 2h
new sn_obs_aia_eval.EvalCleanup().run({ dryRun: true });        // preview only
```

If `EvalCleanup` isn't available, manually unstick:

```js
// Diagnose — confirm all metric results are terminal
var mr = new GlideRecord('sys_one_extend_eval_metric_result');
mr.addQuery('batch_run', '<BATCH_RUN_ID>');
mr.addQuery('status', 'NOT IN', 'completed,error');
mr.query();
gs.info('Non-terminal metric results: ' + mr.getRowCount()); // must be 0 to proceed

// Fix — complete stuck batch_run_tasks then the batch_run
var bt = new GlideRecord('sys_one_extend_batch_run_task');
bt.addQuery('batch_run', '<BATCH_RUN_ID>');
bt.query();
while (bt.next()) {
    bt.setValue('status', 'completed');
    bt.setValue('processed_capability_count', bt.getValue('expected_capability_invocation_count'));
    bt.update();
}
var br = new GlideRecord('sys_one_extend_batch_run');
if (br.get('<BATCH_RUN_ID>')) { br.setValue('status', 'completed'); br.update(); }
// Setting batch_run.status=completed triggers GenerateInsights BR -> populates dashboard
```

> REST API writes to `sys_one_extend_batch_run_task` are silently ignored — must use GlideRecord.
