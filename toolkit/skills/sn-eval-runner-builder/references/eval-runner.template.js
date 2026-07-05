/**
 * Eval runner Script Include template — KNOWN-GOOD shape for `/sn-eval-runner-builder` Step 3.
 *
 * Copy this into <agent>-eval-runner.server.js (fluent path) or paste directly into a new
 * sys_script_include record (Platform UI path — see SKILL.md Step 5 Option B). Replace every
 * <angle-bracket> placeholder before use: <AgentName>, <scope>, <usecase-sys-id>,
 * <internal-name>, <agent-sys-id>, <unique-id-prefix>, <N> (max rows), <agent_slug>.
 *
 * Patterns baked into this template (verified end-to-end against real eval runs — see
 * SKILL.md "How It Works" for the rationale behind each):
 *   - Comprehensive _preflight() — 7 checks that catch the long tail of `state_reason:
 *     no_activity` failures BEFORE any records are created.
 *   - run() auto-invokes process() on cloud instances; falls back to a manual two-step
 *     pattern on localhost where KMF/crypto modules are unavailable.
 *   - groundtruthsysid attribute mapping — required by GT-based metrics; drop the entry
 *     in both run() and process() if the eval uses no GT-based metric.
 *   - _resolveMetrics() walks sys_one_extend_capability -> ...capability_definition ->
 *     sys_generative_ai_config so metric sys_ids are never hardcoded (they vary by LLM
 *     provider/instance).
 */
var <AgentName>EvalRunner = Class.create();
<AgentName>EvalRunner.prototype = {
    initialize: function () {},

    /**
     * Pre-flight validation. Verifies all the wiring an eval run depends on is in
     * place BEFORE creating any records. Eliminates the long tail of failures that
     * present as `state_reason: no_activity` or stuck tasks.
     *
     * Checks:
     *   1. Usecase readable via GlideRecordSecure (catches ACL gaps the API hits at runtime)
     *   2. A published sn_aia_version exists for the usecase
     *   3. Expected agent record exists
     *   4. sn_aia_agent_config.active = true for that agent
     *   5. At least one sn_aia_team_member references the agent
     *   6. Agent has tools attached via sn_aia_agent_tool_m2m
     *   7. >= 1 aia_artifact_dataset row matches the eval filter
     *
     * @param {string} usecaseId        - sys_id of sn_aia_usecase
     * @param {string} expectedAgentId  - sys_id of the agent the team_member must reference
     * @param {string} datasetFilter    - encoded query for aia_artifact_dataset
     * @returns {{ ok: boolean, errors: string[], warnings: string[], toolCount: number }}
     */
    _preflight: function (usecaseId, expectedAgentId, datasetFilter) {
        var L = '[<scope>] preflight: ';
        var errors = [];
        var warnings = [];

        // 1. Usecase readable via GlideRecordSecure (matches what the API uses)
        var ucGrs = new GlideRecordSecure('sn_aia_usecase');
        if (!ucGrs.get(usecaseId)) {
            errors.push('Usecase ' + usecaseId + ' not readable via GlideRecordSecure — likely missing execute/read ACL');
        }

        // 2. Published version for usecase
        var verGr = new GlideRecord('sn_aia_version');
        verGr.addQuery('state', 'published');
        verGr.addQuery('target_id', usecaseId);
        verGr.addQuery('target_table', 'sn_aia_usecase');
        verGr.setLimit(1);
        verGr.query();
        if (!verGr.next()) {
            errors.push('No published sn_aia_version found for usecase ' + usecaseId);
        }

        // 3 + 4. Agent + agent_config.active
        var agentGr = new GlideRecord('sn_aia_agent');
        if (!agentGr.get(expectedAgentId)) {
            errors.push('Expected agent not found: ' + expectedAgentId);
        } else {
            var cfgGr = new GlideRecord('sn_aia_agent_config');
            cfgGr.addQuery('agent', expectedAgentId);
            cfgGr.setLimit(1);
            cfgGr.query();
            if (!cfgGr.next()) {
                errors.push('Agent ' + expectedAgentId + ' has no sn_aia_agent_config row');
            } else if (cfgGr.getValue('active') !== '1' && cfgGr.getValue('active') !== 'true') {
                errors.push('Agent ' + expectedAgentId + ' agent_config.active = false — activate the agent before running evals');
            }
        }

        // 5. team_member references expected agent
        var tmGr = new GlideRecord('sn_aia_team_member');
        tmGr.addQuery('agent', expectedAgentId);
        tmGr.setLimit(1);
        tmGr.query();
        if (!tmGr.next()) {
            errors.push('No sn_aia_team_member references agent ' + expectedAgentId + ' — eval team is missing a member');
        }

        // 6. Tools attached
        var toolM2mGr = new GlideRecord('sn_aia_agent_tool_m2m');
        toolM2mGr.addQuery('agent', expectedAgentId);
        toolM2mGr.addQuery('active', true);
        toolM2mGr.query();
        var toolCount = toolM2mGr.getRowCount();
        if (toolCount === 0) {
            errors.push('Agent ' + expectedAgentId + ' has no active tools attached via sn_aia_agent_tool_m2m');
        }

        // 7. Dataset rows match filter
        var dsGr = new GlideRecord('aia_artifact_dataset');
        dsGr.addEncodedQuery(datasetFilter);
        dsGr.query();
        var dsCount = dsGr.getRowCount();
        if (dsCount === 0) {
            errors.push('No aia_artifact_dataset rows match filter: ' + datasetFilter);
        }

        if (errors.length === 0) {
            gs.info(L + 'OK — agent active, ' + toolCount + ' tools, ' + dsCount + ' dataset row(s)');
        } else {
            for (var i = 0; i < errors.length; i++) gs.error(L + 'FAIL: ' + errors[i]);
        }
        for (var j = 0; j < warnings.length; j++) gs.warn(L + 'WARN: ' + warnings[j]);

        return { ok: errors.length === 0, errors: errors, warnings: warnings, toolCount: toolCount };
    },

    /**
     * Resolves agentic eval metric definitions dynamically from the instance.
     *
     * Walks: sys_one_extend_capability -> sys_one_extend_capability_definition
     *        -> sys_generative_ai_config
     *
     * This avoids hardcoding instance-specific sys_ids that vary by LLM provider.
     *
     * @param {string[]} metricNames - display names of metric capabilities
     * @returns {Array<{genAIConfigId: string, definitionId: string, evalMetricName: string}>}
     */
    _resolveMetrics: function (metricNames) {
        var L = '[<scope>] ';
        var methods = [];

        for (var i = 0; i < metricNames.length; i++) {
            var name = metricNames[i];

            // 1. Find the OOTB capability by name
            var capGr = new GlideRecord('sys_one_extend_capability');
            capGr.addQuery('name', name);
            capGr.addQuery('active', true);
            capGr.setLimit(1);
            capGr.query();
            if (!capGr.next()) {
                gs.warn(L + '_resolveMetrics: capability not found: ' + name);
                continue;
            }
            var capId = capGr.getUniqueValue();

            // 2. Find definitions for this capability
            var defGr = new GlideRecord('sys_one_extend_capability_definition');
            defGr.addQuery('capability', capId);
            defGr.query();

            var bestConfigId = '';
            var bestDefId = '';

            while (defGr.next()) {
                var defId = defGr.getUniqueValue();
                // 3. Check for a matching genAI config (prefer active)
                var cfgGr = new GlideRecord('sys_generative_ai_config');
                cfgGr.addQuery('definition', defId);
                cfgGr.addQuery('definition_table', 'sys_one_extend_capability_definition');
                cfgGr.orderByDesc('active');
                cfgGr.setLimit(1);
                cfgGr.query();
                if (cfgGr.next()) {
                    var cfgId = cfgGr.getUniqueValue();
                    var isActive = cfgGr.getValue('active') === 'true';
                    if (!bestConfigId || (isActive && !bestConfigId)) {
                        bestConfigId = cfgId;
                        bestDefId = defId;
                    }
                    if (isActive) break;
                }
            }

            if (!bestDefId) {
                gs.warn(L + '_resolveMetrics: no definition/config for capability: ' + name + ' (' + capId + ')');
                continue;
            }

            gs.info(L + '_resolveMetrics: ' + name +
                ' -> capId=' + capId + ', defId=' + bestDefId + ', genAIConfigId=' + bestConfigId);

            methods.push({
                genAIConfigId: bestConfigId,
                definitionId: bestDefId,
                evalMetricName: name,
            });
        }

        return methods;
    },

    /**
     * Runs the full agentic eval flow (steps 1+2+3).
     *
     * On cloud instances a single call to run() completes everything: it creates
     * the eval run, creates the dataset, then auto-invokes this.process() to start
     * the Auto Chat conversations. The caller does not need to call process()
     * separately.
     *
     * Default usage from Scripts > Background (Global scope):
     *
     *   var runner = new <scope>.<AgentName>EvalRunner();
     *   var r = runner.run({ maxRows: '3' });
     *   // run() already called process() internally — no separate call needed.
     *
     * If the auto-invoked process() fails (e.g. on localhost where KMF/crypto
     * modules are unavailable), run() returns
     * { success: false, step: 'processAgenticEvalRun', evalRunId, datasetId }.
     * Re-invoke process() manually in a separate execution as a fallback:
     *
     *   new <scope>.<AgentName>EvalRunner().process('<evalRunId>', '<datasetId>');
     *
     * @param {Object} [options]
     * @param {string} [options.usecaseId]         - sys_id of the sn_aia_usecase record (auto-detected if omitted)
     * @param {string} [options.versionId]         - sys_id of the sn_aia_version record (auto-detected if omitted)
     * @param {string} [options.agentId]           - sys_id of the agent for preflight checks (default: DEFAULT_AGENT_ID)
     * @param {string} [options.runName]           - Override the auto-generated run name
     * @param {string} [options.datasetName]       - Override the auto-generated dataset name
     * @param {string} [options.maxRows]           - Max test cases to evaluate (default: '<N>')
     * @param {Array}  [options.evaluationMethods] - Override default metrics
     * @returns {{ success: boolean, evalRunId: string, datasetId: string }|{ success: boolean, error: string }}
     */
    run: function (options) {
        var opts = options || {};

        var dt = new GlideDateTime();
        var DATE_TIME = dt
            .getValue()
            .replace(/[^0-9]/g, '')
            .substring(0, 12)
            .replace(/^(\d{8})(\d{4})$/, '$1_$2');

        var L = '[<scope>] ';
        var DEFAULT_USECASE_ID = '<usecase-sys-id>';
        var USECASE_INTERNAL_NAME = '<internal-name>';  // e.g. 'global.<scope>.<Agent Name>'
        var DEFAULT_AGENT_ID = '<agent-sys-id>';        // sys_id of sn_aia_agent — used by preflight
        var UNIQUE_ID_PREFIX = '<unique-id-prefix>';    // e.g. 'my-agent-'
        var RUN_NAME = opts.runName || '<agent_slug>_eval_' + DATE_TIME;
        var DATASET_NAME = opts.datasetName || DATE_TIME + '_<AgentName>';
        var MAX_ROWS = opts.maxRows || '<N>';
        // Honor caller-provided filter; otherwise default to the agent's unique_id prefix.
        // Auto-append ^ground_truthISNOTEMPTY unless ground_truth is already constrained —
        // GT-scored metrics silently score NA on rows without a ground_truth reference.
        var BASE_FILTER = opts.filter || 'unique_idSTARTSWITH' + UNIQUE_ID_PREFIX;
        var DATASET_FILTER = BASE_FILTER.indexOf('ground_truth') >= 0
            ? BASE_FILTER
            : BASE_FILTER + '^ground_truthISNOTEMPTY';

        gs.info(L + '=== START eval run ===');
        gs.info(L + 'Config: maxRows=' + MAX_ROWS + ' filter=' + DATASET_FILTER);

        /************************************************************
         * RESOLVE: Usecase
         ************************************************************/
        var USECASE_ID = opts.usecaseId;
        if (!USECASE_ID) {
            var ucGr = new GlideRecord('sn_aia_usecase');
            if (ucGr.get(DEFAULT_USECASE_ID)) {
                USECASE_ID = DEFAULT_USECASE_ID;
                gs.info(L + 'Resolved usecase by sys_id: ' + USECASE_ID +
                    ' | name=' + ucGr.getValue('name') +
                    ' | internal_name=' + ucGr.getValue('internal_name'));
            } else {
                ucGr = new GlideRecord('sn_aia_usecase');
                ucGr.addQuery('internal_name', USECASE_INTERNAL_NAME);
                ucGr.setLimit(1);
                ucGr.query();
                if (!ucGr.next()) {
                    gs.error(L + 'FAIL: Usecase not found by sys_id (' + DEFAULT_USECASE_ID +
                        ') or internal_name (' + USECASE_INTERNAL_NAME + ')');
                    return { success: false, error: 'Usecase not found: ' + USECASE_INTERNAL_NAME };
                }
                USECASE_ID = ucGr.getUniqueValue();
                gs.info(L + 'Resolved usecase by internal_name: ' + USECASE_ID);
            }
        }

        /************************************************************
         * RESOLVE: Version
         ************************************************************/
        var VERSION_ID = opts.versionId;
        if (!VERSION_ID) {
            var versionGr = new GlideRecord('sn_aia_version');
            versionGr.addQuery('state', 'published');
            versionGr.addQuery('target_id', USECASE_ID);
            versionGr.addQuery('target_table', 'sn_aia_usecase');
            versionGr.orderByDesc('sys_created_on');
            versionGr.setLimit(1);
            versionGr.query();
            if (!versionGr.next()) {
                gs.error(L + 'FAIL: No published version for usecase ' + USECASE_ID);
                return { success: false, error: 'No published version for usecase: ' + USECASE_ID };
            }
            VERSION_ID = versionGr.getUniqueValue();
            gs.info(L + 'Resolved version: ' + VERSION_ID +
                ' | name=' + versionGr.getValue('version_name') +
                ' | state=' + versionGr.getValue('state'));
        }

        /************************************************************
         * PRE-FLIGHT — abort early if wiring is broken
         *
         * Checks ACL, published version, agent active, team membership,
         * tools attached, and dataset rows BEFORE creating any records.
         * Prevents the long tail of `state_reason: no_activity` failures.
         ************************************************************/
        var EXPECTED_AGENT_ID = opts.agentId || DEFAULT_AGENT_ID;
        var preflight = this._preflight(USECASE_ID, EXPECTED_AGENT_ID, DATASET_FILTER);
        if (!preflight.ok) {
            gs.error(L + 'ABORTED before STEP 1 — preflight failed: ' + preflight.errors.join('; '));
            return {
                success: false,
                step: 'preflight',
                error: 'preflight failed: ' + preflight.errors.join('; '),
                preflight: preflight,
            };
        }

        /************************************************************
         * EVALUATION METRICS
         *
         * Resolved dynamically via _resolveMetrics() which walks:
         *   sys_one_extend_capability
         *     -> sys_one_extend_capability_definition
         *     -> sys_generative_ai_config
         *
         * This avoids hardcoding sys_ids that vary by instance
         * and LLM provider configuration.
         *
         * Non-agentic metrics (Faithfulness, Correctness) use
         * {{generated_response}} which is never populated for
         * agentic flows — do NOT add them here.
         ************************************************************/
        var DEFAULT_METRIC_NAMES = [
            'Overall task completeness evaluation',
            'Tool performance evaluation',
            'Tool calling evaluation',
            // 'Plan evaluation',  // optional — uncomment if needed
            // 'Tool calling correctness (GT)',  // optional — requires ground_truth record on each dataset row + groundtruthsysid attribute mapping
        ];
        var evaluationMethods = opts.evaluationMethods ||
            this._resolveMetrics(opts.metricNames || DEFAULT_METRIC_NAMES);

        if (!evaluationMethods.length) {
            gs.error(L + 'FAIL: no evaluation metrics resolved — check sys_one_extend_capability for: ' +
                DEFAULT_METRIC_NAMES.join(', '));
            return { success: false, error: 'No evaluation metrics could be resolved on this instance' };
        }
        gs.info(L + 'Resolved ' + evaluationMethods.length + ' metrics');

        var api = new sn_skill_builder.NowAssistSkillKitAPI();

        /************************************************************
         * STEP 1: Create eval run
         ************************************************************/
        gs.info(L + 'STEP 1: createAgenticEvalRun(' +
            'name=' + RUN_NAME +
            ', usecaseId=' + USECASE_ID +
            ', versionId=' + VERSION_ID +
            ', metrics=' + evaluationMethods.length + ')');

        var createRunResp = api.createAgenticEvalRun(
            RUN_NAME,           // name
            '',                 // testDatasetId (dataset created separately)
            USECASE_ID,         // usecaseId — from sn_aia_usecase
            evaluationMethods,  // evaluationMethods
            null,               // usecaseTable (defaults to sn_aia_usecase)
            VERSION_ID,         // usecaseVersionId
            null,               // usecaseVersionTable
            'agentic_ai',       // evaluationType
        );

        gs.info(L + 'STEP 1 response: ' + JSON.stringify(createRunResp));

        if (createRunResp.isError) {
            gs.error(L + 'FAIL at STEP 1: ' + createRunResp.errorMessage);
            return { success: false, error: createRunResp.errorMessage, step: 'createAgenticEvalRun' };
        }

        var evalRunId = createRunResp.evaluationRunId;
        gs.info(L + 'STEP 1 OK: evalRunId=' + evalRunId);

        /************************************************************
         * STEP 2: Create dataset from aia_artifact_dataset records
         ************************************************************/
        var datasetObj = {
            datasetId: '',
            attributeMappings: [{
                datasetAttributeMappings: [
                    {
                        // Always include — needed for execution-plan-based metrics
                        // (Tool choice accuracy, Tool calling correctness, Overall task completeness).
                        datasetAttribute: {
                            name: 'executionplansysid',
                            label: 'ExecutionPlanSysID',
                            attributeDataType: 'string',
                            attributeType: 'INPUT',
                            mandatory: false,
                            // sys_id of the 'ExecutionPlanSysID' dataset attribute — stable across instances
                            attributeId: 'cd903b16eb6ad610b356f4a8cad0cd38',
                        },
                        datasetAttributeMapping: {
                            datasetOutputTemplate: '{{auto_chat_level_one_result.execution_record}}',
                            datasetOutputScript: '',
                        },
                    },
                    {
                        // Required if you use any "(GT)" metric, e.g. "Tool calling correctness (GT)".
                        // Maps the dataset row's ground_truth reference into the eval pipeline.
                        // Drop this entry entirely if no GT-based metrics are used.
                        datasetAttribute: {
                            name: 'groundtruthsysid',
                            label: 'GroundtruthSysId',
                            attributeDataType: 'string',
                            attributeType: 'INPUT',
                            mandatory: true,
                            // sys_id of the 'groundtruthsysid' dataset attribute — required by GT-based metrics
                            attributeId: '21ffd174ff3362109903ffffffffff24',
                        },
                        datasetAttributeMapping: {
                            datasetOutputTemplate: '{{aia_artifact_dataset.ground_truth}}',
                            datasetOutputScript: '',
                        },
                    },
                ],
            }],
            datasetType: 'table',
            maxRowLimit: MAX_ROWS,
            tableFilter: DATASET_FILTER,
            testDataset: {
                datasetSource: 'ai',
                description: '<Agent display name> agent eval dataset — ' + DATE_TIME,
                evaluationType: 'agentic_ai',
                name: DATASET_NAME,
                status: 'draft',
                table: 'aia_artifact_dataset',
                filter: DATASET_FILTER,
                runType: 'eval_run',
                internal: 'false',
            },
            autoChatConfigDetails: {
                initial_query: '{{aia_artifact_dataset.initial_query}}',
                end_goal: '{{aia_artifact_dataset.end_goal}}',
                context_scenario: '{{aia_artifact_dataset.context_scenario}}',
                business_knowledge: '',
                external_knowledge: '',
            },
        };

        gs.info(L + 'STEP 2: createAgenticEvalDataset for evalRunId=' + evalRunId);

        var datasetResp = api.createAgenticEvalDataset(datasetObj, evalRunId);
        gs.info(L + 'STEP 2 response: ' + JSON.stringify(datasetResp));

        if (datasetResp.isError) {
            gs.error(L + 'FAIL at STEP 2: ' + datasetResp.errorMessage);
            return { success: false, error: datasetResp.errorMessage, step: 'createAgenticEvalDataset' };
        }

        var datasetId = datasetResp.datasetId;
        gs.info(L + 'STEP 2 OK: datasetId=' + datasetId);

        gs.info(L + '=== Steps 1+2 DONE === runId=' + evalRunId + ' datasetId=' + datasetId);
        gs.info(L + 'Dashboard: /now/now-assist-skillkit/evaluation-results-dashboard/' + evalRunId);

        /************************************************************
         * STEP 3 (auto): Trigger Auto Chat conversations
         *
         * Auto-invoked on cloud instances so a single run() call completes
         * the full eval flow. If this fails (e.g. on localhost due to
         * missing KMF/crypto modules), the caller can fall back to the
         * two-step pattern by invoking process(evalRunId, datasetId)
         * in a separate Scripts > Background execution.
         ************************************************************/
        gs.info(L + 'STEP 3 (auto): invoking process()');
        var processResp = this.process(evalRunId, datasetId);
        if (!processResp.success) {
            gs.warn(L + 'STEP 3 auto-process FAILED: ' + processResp.error +
                ' — fall back to two-step: new <scope>.<AgentName>EvalRunner().process(\'' +
                evalRunId + '\', \'' + datasetId + '\');');
            return {
                success: false,
                error: processResp.error,
                step: 'processAgenticEvalRun',
                evalRunId: evalRunId,
                datasetId: datasetId,
            };
        }

        return { success: true, evalRunId: evalRunId, datasetId: datasetId };
    },

    /**
     * Run step 3 (processAgenticEvalRun) to start Auto Chat conversations.
     *
     * Auto-invoked by run() on cloud instances. Exposed publicly so callers
     * can manually re-invoke it as a fallback when the auto-invoke fails
     * (e.g. on localhost where KMF/crypto modules are unavailable), or to
     * reprocess a stuck eval run.
     *
     * Manual call from Scripts > Background (Global scope):
     *   new <scope>.<AgentName>EvalRunner().process('<evalRunId>', '<datasetId>');
     *
     * @param {string} evalRunId - sys_id of the sys_one_extend_batch_run record
     * @param {string} datasetId - sys_id of the sys_one_extend_test_dataset record
     * @returns {{ success: boolean }|{ success: boolean, error: string }}
     */
    process: function (evalRunId, datasetId) {
        var L = '[<scope>] ';
        gs.info(L + 'process(): evalRunId=' + evalRunId + ', datasetId=' + datasetId);

        // Verify the auto_chat_configuration record exists before calling
        var configGr = new GlideRecord('auto_chat_configuration');
        configGr.addQuery('batch_run', evalRunId);
        configGr.setLimit(1);
        configGr.query();
        if (!configGr.next()) {
            gs.error(L + 'process() FAIL: no auto_chat_configuration with batch_run=' + evalRunId +
                ' — was run() called in a different script execution?');
            return { success: false, error: 'auto_chat_configuration not found for batch_run=' + evalRunId };
        }
        gs.info(L + 'auto_chat_configuration verified: ' + configGr.getUniqueValue());

        // Rebuild minimal datasetObj — processAgenticEvalRun needs attributeMappings.
        // KEEP THIS IN SYNC with the mappings created in run().
        var datasetObj = {
            datasetId: datasetId,
            attributeMappings: [{
                datasetAttributeMappings: [
                    {
                        datasetAttribute: {
                            name: 'executionplansysid',
                            label: 'ExecutionPlanSysID',
                            attributeDataType: 'string',
                            attributeType: 'INPUT',
                            mandatory: false,
                            attributeId: 'cd903b16eb6ad610b356f4a8cad0cd38',
                        },
                        datasetAttributeMapping: {
                            datasetOutputTemplate: '{{auto_chat_level_one_result.execution_record}}',
                            datasetOutputScript: '',
                        },
                    },
                    {
                        // Drop this entry if no GT-based metric is used.
                        datasetAttribute: {
                            name: 'groundtruthsysid',
                            label: 'GroundtruthSysId',
                            attributeDataType: 'string',
                            attributeType: 'INPUT',
                            mandatory: true,
                            attributeId: '21ffd174ff3362109903ffffffffff24',
                        },
                        datasetAttributeMapping: {
                            datasetOutputTemplate: '{{aia_artifact_dataset.ground_truth}}',
                            datasetOutputScript: '',
                        },
                    },
                ],
            }],
        };

        var api = new sn_skill_builder.NowAssistSkillKitAPI();
        var resp = api.processAgenticEvalRun(evalRunId, datasetId, datasetObj, false);
        gs.info(L + 'process() response: ' + JSON.stringify(resp));

        if (resp.isError) {
            gs.error(L + 'process() FAIL: ' + resp.errorMessage);
            return { success: false, error: resp.errorMessage };
        }

        gs.info(L + 'process() OK — eval run processing triggered');
        gs.info(L + 'Dashboard: /now/now-assist-skillkit/evaluation-results-dashboard/' + evalRunId);
        return { success: true };
    },

    type: '<AgentName>EvalRunner',
};
