import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDeleteRecordTool } from '../build/tools/delete-record-tool.js';
import { createDiagnoseMutationTool } from '../build/tools/diagnose-mutation-tool.js';
import { EXECUTE_BACKGROUND_SCRIPT_TOOL, createExecuteBackgroundScriptTool } from '../build/tools/execute-background-script-tool.js';
import { DELETE_RECORD_TOOL } from '../build/tools/delete-record-tool.js';
import { createUpdateRecordTool } from '../build/tools/update-record-tool.js';

test('tool descriptions route ordinary deletion to the dedicated delete tool first', () => {
	assert.match(DELETE_RECORD_TOOL.description, /FIRST and preferred tool/i);
	assert.match(DELETE_RECORD_TOOL.description, /before attempting GlideRecord\.deleteRecord/);
	assert.match(EXECUTE_BACKGROUND_SCRIPT_TOOL.description, /call sn_delete_record FIRST/);
});

test('background script reports application outcome false as an error', async () => {
	const tool = createExecuteBackgroundScriptTool({
		async executeBackgroundScript() {
			return { success: true, output: '{"ok":false,"reason":"abort"}', executionTime: 1, executionPath: 'scripted-rest', outcome: 'completed' };
		},
	});
	const res = await tool.handler({ script: 'log(JSON.stringify({ok:false}));', resultMode: 'json' });
	assert.equal(res.isError, true);
	assert.equal(res.structuredContent.transportSuccess, true);
	assert.equal(res.structuredContent.applicationSuccess, false);
});

test('security metadata writes require the explicit break-glass flag even without elicitation support', async () => {
	let called = false;
	const tool = createExecuteBackgroundScriptTool({ async executeBackgroundScript() { called = true; } });
	const res = await tool.handler({
		script: "var gr=new GlideRecord('sys_security_acl');gr.get('abc');gr.setValue('active',false);gr.update();",
		allowWrites: true,
	});
	assert.equal(res.isError, true);
	assert.match(res.content[0].text, /second explicit approval/);
	assert.equal(called, false);
});

test('update verification fails when persisted value differs', async () => {
	const service = {
		async updateRecord() { return { sys_id: 'a'.repeat(32), active: 'true' }; },
		async getRecord() { return { sys_id: 'a'.repeat(32), active: 'false' }; },
	};
	const res = await createUpdateRecordTool(service).handler({
		tableName: 'incident', sysId: 'a'.repeat(32), fields: { active: true }, verify: true,
	});
	assert.equal(res.isError, true);
	assert.equal(res.structuredContent.verification.persisted, false);
});

test('delete verification fails when record still exists', async () => {
	const service = {
		async deleteRecord() { return { success: true, message: 'deleted' }; },
		async getRecord() { return { sys_id: 'a'.repeat(32) }; },
	};
	const res = await createDeleteRecordTool(service).handler({ tableName: 'incident', sysId: 'a'.repeat(32), verify: true });
	assert.equal(res.isError, true);
	assert.equal(res.structuredContent.verification.deleted, false);
});

test('mutation diagnostic parses the final JSON log line', async () => {
	const tool = createDiagnoseMutationTool({
		async executeBackgroundScript(script) {
			assert.match(script, /GlideRecordSecure/);
			return { success: true, output: 'prefix\n{"recordExists":true,"capabilities":{"canWrite":false},"fieldCapabilities":[],"activeBusinessRules":[],"applicableAcls":[],"referenceDependencies":[]}' };
		},
	});
	const res = await tool.handler({ tableName: 'incident', sysId: 'a'.repeat(32), operation: 'update', fields: ['active'] });
	assert.equal(res.structuredContent.recordExists, true);
	assert.equal(res.structuredContent.capabilities.canWrite, false);
});