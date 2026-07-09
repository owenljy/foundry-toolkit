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
Produces: acls {total, byOperation, tableLevel, fieldLevel, details}, roleRequirements (ACL→role links), dataPolicies, securityBusinessRules, and warnings for any section that could not be read.`,
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
				): Promise<{ records: ServiceNowRecord[]; error?: string }> => {
					try {
						const records = await tableService.queryRecords(
							table,
							{ query, fields, limit },
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

				const [aclResult, dataPolicyResult, businessRuleResult] = await Promise.all([
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
				]);

				const aclRecords = aclResult.records;

				// Resolve the role requirements for the first ACLs found.
				let roleRequirements: ServiceNowRecord[] = [];
				if (aclRecords.length > 0) {
					const ids = aclRecords
						.map((acl) => acl.sys_id)
						.filter((id): id is string => typeof id === 'string' && id.length > 0)
						.slice(0, 20);
					if (ids.length > 0) {
						const roleQuery = ids.map((id) => `sys_security_acl=${id}`).join('^OR');
						const roleResult = await safeQuery(
							'sys_security_acl_role',
							roleQuery,
							['sys_security_acl', 'sys_user_role'],
							200,
						);
						roleRequirements = roleResult.records;
					}
				}

				// Summarize ACLs: counts per operation, table-level vs field-level.
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

				const response: Record<string, unknown> = {
					success: true,
					table: t,
					acls: {
						total: aclRecords.length,
						byOperation,
						tableLevel,
						fieldLevel,
						details: aclRecords,
					},
					roleRequirements,
					dataPolicies: dataPolicyResult.records,
					securityBusinessRules: businessRuleResult.records,
				};
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
				return toolError(error, { table: tableName, operation: 'get security info', requiredRoles: ['admin', 'security_admin'] });
			}
		},
	};
}
