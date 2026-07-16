/**
 * MCP tool for a consolidated view of what protects a table:
 * ACLs, role requirements, data policies, and security business rules.
 *
 * Read-only. Orchestrates several tableService.queryRecords calls; each section
 * degrades independently so one missing permission only empties that section.
 */

import {
	GetSecurityInfoOutputSchema,
	GetSecurityInfoSchema,
} from '../schemas/security-info-schemas.js';
import type { TableService } from '../services/table-service.js';
import type { ServiceNowRecord } from '../types/servicenow.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolResult } from '../utils/tool-response.js';

export const GET_SECURITY_INFO_TOOL = {
	name: 'sn_get_security_info',
	title: 'Get security info',
	description: `What: A consolidated view of what protects a table — ACLs (access controls), the roles they require, active data policies, and security-related business rules.
When to use: To understand why access to a table/field is granted or denied, or to audit a table's security posture, without querying each security table separately.
Preconditions: The table should exist. Read access to the security metadata tables (sys_security_acl, sys_data_policy2, sys_script) — a section you cannot read is returned empty with a note in warnings, the call still succeeds.
Produces (default, includeDetails=false): acls {total, byOperation, tableLevel, fieldLevel}, rolesByOperation (role names required per operation), dataPolicies, securityBusinessRules, warnings. Pass includeDetails=true to also get the raw per-ACL detail array and per-ACL role list — much larger, only ask for it when you need the individual ACL rows.`,
	inputSchema: GetSecurityInfoSchema,
	outputSchema: GetSecurityInfoOutputSchema,
};

export function createGetSecurityInfoTool(tableService: TableService) {
	return {
		...GET_SECURITY_INFO_TOOL,
		handler: async (params: unknown) => {
			let tableName: string | undefined;
			try {
				const validated = GetSecurityInfoSchema.parse(params);
				tableName = validated.tableName;
				const instance = validated.instance;
				const t = validated.tableName;
				const includeDetails = validated.includeDetails;
				const operations = validated.operations;
				const fields = validated.fields;

				logger.info(`Getting security info for ${t}`, {
					instance: instance || 'default',
				});

				const warnings: string[] = [];

				// Query one security table, isolating any error to just this section so a
				// single missing permission degrades only that part of the result.
				const safeQuery = async (
					table: string,
					query: string,
					fields: string[],
					limit: number,
					displayValue?: boolean | 'all',
				): Promise<{ records: ServiceNowRecord[]; error?: string }> => {
					try {
						const records = await tableService.queryRecords(
							table,
							{ query, fields, limit, excludeReferenceLink: true, displayValue },
							instance,
						);
						return { records };
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						const note = `Could not read ${table}: ${message}`;
						warnings.push(note);
						logger.warn(note);
						return { records: [], error: message };
					}
				};

				const [aclResult, dataPolicyResult, businessRuleResult, beforeBrResult, dictionaryResult] =
					await Promise.all([
						safeQuery(
							'sys_security_acl',
							`name=${t}^ORnameLIKE${t}.`,
							['sys_id', 'name', 'operation', 'type', 'active'],
							100,
						),
						safeQuery(
							'sys_data_policy2',
							`model_table=${t}^active=true`,
							['sys_id', 'short_description', 'enforce_ui', 'enforce_scripting'],
							50,
						),
						safeQuery(
							'sys_script',
							`collection=${t}^active=true^scriptLIKEgs.hasRole^ORscriptLIKEgs.getUser`,
							['sys_id', 'name', 'when', 'collection'],
							30,
						),
						safeQuery(
							'sys_script',
							`collection=${t}^active=true^when=before`,
							[
								'sys_id',
								'name',
								'when',
								'order',
								'action_update',
								'action_delete',
								'filter_condition',
								'script',
							],
							100,
						),
						safeQuery(
							'sys_dictionary',
							`name=${t}^elementISNOTEMPTY`,
							[
								'sys_id',
								'name',
								'element',
								'internal_type',
								'reference',
								'reference_cascade_rule',
								'read_only',
								'mandatory',
							],
							300,
						),
					]);

				const aclRecords = aclResult.records.filter((acl) => {
					const operation = String(acl.operation ?? '');
					const name = String(acl.name ?? '');
					if (operations?.length && !operations.includes(operation as never)) return false;
					if (fields?.length && name !== t && !fields.some((f) => name === `${t}.${f}`))
						return false;
					return true;
				});
				const aclById = new Map(aclRecords.map((acl) => [acl.sys_id, acl]));

				// Resolve role requirements for the ACLs found. displayValue: 'all' turns
				// each reference field into {value, display_value} so the role comes back
				// as its name (e.g. "admin") instead of a bare sys_id — no second lookup.
				let roleRecords: ServiceNowRecord[] = [];
				if (aclRecords.length > 0) {
					const ids = aclRecords
						.map((acl) => acl.sys_id)
						.filter((id): id is string => typeof id === 'string' && id.length > 0);
					const cappedIds = ids.slice(0, 20);
					if (ids.length > cappedIds.length) {
						warnings.push(
							`Role lookup covers only the first ${cappedIds.length} of ${ids.length} ACLs — role requirements for the rest were not resolved.`,
						);
					}
					if (cappedIds.length > 0) {
						const roleQuery = cappedIds.map((id) => `sys_security_acl=${id}`).join('^OR');
						const roleResult = await safeQuery(
							'sys_security_acl_role',
							roleQuery,
							['sys_security_acl', 'sys_user_role'],
							200,
							'all',
						);
						roleRecords = roleResult.records;
					}
				}

				const refValue = (field: unknown): string | undefined =>
					typeof field === 'object' && field !== null && 'value' in field
						? String((field as { value: unknown }).value)
						: typeof field === 'string'
							? field
							: undefined;
				const refDisplay = (field: unknown): string | undefined =>
					typeof field === 'object' && field !== null && 'display_value' in field
						? String((field as { display_value: unknown }).display_value)
						: undefined;

				// Summarize ACLs: counts per operation, table-level vs field-level, and
				// which role names are required per operation.
				const byOperation: Record<string, number> = {};
				let tableLevel = 0;
				let fieldLevel = 0;
				for (const acl of aclRecords) {
					const operation =
						typeof acl.operation === 'string' ? acl.operation : String(acl.operation ?? '');
					if (operation) {
						byOperation[operation] = (byOperation[operation] ?? 0) + 1;
					}
					const name = typeof acl.name === 'string' ? acl.name : '';
					if (name === t) {
						tableLevel += 1;
					} else if (name.includes('.')) {
						fieldLevel += 1;
					}
				}

				const rolesByOperationSets: Record<string, Set<string>> = {};
				for (const role of roleRecords) {
					const aclId = refValue(role.sys_security_acl);
					const roleName = refDisplay(role.sys_user_role) ?? refValue(role.sys_user_role);
					const acl = aclId ? aclById.get(aclId) : undefined;
					const operation =
						acl && typeof acl.operation === 'string' ? acl.operation : (acl?.operation ?? '');
					const operationKey = String(operation || 'unknown');
					if (!roleName) continue;
					(rolesByOperationSets[operationKey] ??= new Set()).add(roleName);
				}
				const rolesByOperation: Record<string, string[]> = {};
				for (const [operation, names] of Object.entries(rolesByOperationSets)) {
					rolesByOperation[operation] = Array.from(names).sort();
				}

				const acls: Record<string, unknown> = {
					total: aclRecords.length,
					byOperation,
					tableLevel,
					fieldLevel,
				};
				const response: Record<string, unknown> = {
					success: true,
					table: t,
					acls,
					rolesByOperation,
					dataPolicies: dataPolicyResult.records,
					securityBusinessRules: businessRuleResult.records,
					beforeBusinessRules: beforeBrResult.records.map((br) => ({
						...br,
						hasAbortAction: String(br.script ?? '').includes('setAbortAction'),
					})),
					dictionary: dictionaryResult.records,
				};
				if (includeDetails) {
					acls.details = aclRecords;
					response.roleRequirements = roleRecords;
				}
				if (warnings.length > 0) {
					response.warnings = warnings;
				}

				return toolResult(
					response,
					`${aclRecords.length} ACL(s), ${dataPolicyResult.records.length} data policy(ies) on ${t}${
						warnings.length > 0 ? ' — see warnings' : ''
					}`,
				);
			} catch (error) {
				logger.error('Error getting security info', error);
				return toolError(error, {
					table: tableName,
					operation: 'get security info',
					requiredRoles: ['admin', 'security_admin'],
				});
			}
		},
	};
}
