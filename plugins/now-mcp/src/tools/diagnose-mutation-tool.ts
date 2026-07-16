import {
	DiagnoseMutationOutputSchema,
	DiagnoseMutationSchema,
} from '../schemas/mutation-diagnostic-schemas.js';
import type { ScriptService } from '../services/script-service.js';
import { toolError } from '../utils/error-handler.js';
import { toolResult } from '../utils/tool-response.js';

export const DIAGNOSE_MUTATION_TOOL = {
	name: 'sn_diagnose_mutation',
	title: 'Diagnose blocked mutation',
	description: `What: Read-only diagnostics for a record update/delete: runtime canWrite/canDelete, requested field writability, active before business rules (including abort-capable rules), applicable ACL metadata, and inbound reference counts.
When to use: Before changing ACLs or disabling business rules when an update/delete was denied, returned null/false, or failed read-after-write verification.
Preconditions: Elevated access to the target and security metadata. Uses the background-script transport, but the diagnostic script itself performs no writes.
Limitations: This identifies likely blockers; it does not execute a dry-run mutation and cannot prove which rule would abort for a specific proposed value. ACL scripts are reported, not evaluated individually.`,
	inputSchema: DiagnoseMutationSchema,
	outputSchema: DiagnoseMutationOutputSchema,
};

export function createDiagnoseMutationTool(scriptService: ScriptService) {
	return {
		...DIAGNOSE_MUTATION_TOOL,
		handler: async (params: unknown) => {
			try {
				const v = DiagnoseMutationSchema.parse(params);
				const script = `(function(){
var out={recordExists:false,capabilities:{},fieldCapabilities:[],activeBusinessRules:[],applicableAcls:[],referenceDependencies:[]};
var table=${JSON.stringify(v.tableName)}, id=${JSON.stringify(v.sysId)}, op=${JSON.stringify(v.operation)}, fields=${JSON.stringify(v.fields)};
var rec=new GlideRecordSecure(table); out.recordExists=rec.get(id);
if(out.recordExists){out.capabilities={canRead:rec.canRead(),canWrite:rec.canWrite(),canDelete:rec.canDelete(),sysClassName:String(rec.getValue('sys_class_name')||table)};
for(var i=0;i<fields.length;i++){var el=rec.getElement(fields[i]);out.fieldCapabilities.push({field:fields[i],exists:!!el,canRead:!!el&&el.canRead(),canWrite:!!el&&el.canWrite(),value:el&&el.canRead()?String(el.getValue()||''):null});}}
var br=new GlideRecord('sys_script');br.addQuery('collection',table);br.addQuery('active',true);br.addQuery('when','before');br.query();while(br.next()){var s=String(br.getValue('script')||'');out.activeBusinessRules.push({sys_id:String(br.getUniqueValue()),name:String(br.getValue('name')),order:String(br.getValue('order')||''),update:String(br.getValue('action_update')||''),delete:String(br.getValue('action_delete')||''),hasAbort:s.indexOf('setAbortAction')>=0,condition:String(br.getValue('filter_condition')||'')});}
var acl=new GlideRecord('sys_security_acl');acl.addQuery('active',true);acl.addQuery('operation',op);acl.addQuery('name',table).addOrCondition('name','STARTSWITH',table+'.');acl.query();while(acl.next()){out.applicableAcls.push({sys_id:String(acl.getUniqueValue()),name:String(acl.getValue('name')),operation:String(acl.getValue('operation')),hasCondition:!acl.getElement('condition').nil(),hasScript:!acl.getElement('script').nil()});}
var d=new GlideRecord('sys_dictionary');d.addQuery('internal_type','reference');d.addQuery('reference',table);d.addNotNullQuery('element');d.setLimit(100);d.query();while(d.next()){var child=String(d.getValue('name')),field=String(d.getValue('element'));try{var dep=new GlideRecord(child);dep.addQuery(field,id);dep.setLimit(101);dep.query();var n=0;while(dep.next()&&n<101)n++;if(n>0)out.referenceDependencies.push({table:child,field:field,count:n,countCapped:n===101});}catch(e){}}
log(JSON.stringify(out));})();`;
				const r = await scriptService.executeBackgroundScript(script, 60000, v.instance);
				if (!r.success || !r.output)
					throw new Error(r.error || 'Diagnostic script returned no output');
				const parsed = JSON.parse(r.output.trim().split('\n').pop() || '{}');
				const response = {
					success: true,
					table: v.tableName,
					sysId: v.sysId,
					operation: v.operation,
					recordExists: !!parsed.recordExists,
					capabilities: parsed.capabilities || {},
					fieldCapabilities: parsed.fieldCapabilities || [],
					activeBusinessRules: parsed.activeBusinessRules || [],
					applicableAcls: parsed.applicableAcls || [],
					referenceDependencies: parsed.referenceDependencies || [],
					limitations: [
						'No mutation was attempted.',
						'ACL scripts and business-rule conditions were not individually evaluated.',
						'Reference discovery is capped at 100 dictionary fields and 101 rows per dependency.',
					],
				};
				return toolResult(response, `mutation diagnostics collected for ${v.tableName} ${v.sysId}`);
			} catch (error) {
				return toolError(error, {
					operation: 'diagnose mutation',
					requiredRoles: ['admin', 'security_admin'],
				});
			}
		},
	};
}
