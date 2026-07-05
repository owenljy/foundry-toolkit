/**
 * MCP tool: switch which configured instance receives calls that omit 'instance'.
 *
 * This mutates the in-memory session default (InstanceManager.setDefaultInstance)
 * — it does NOT write to any ServiceNow instance and does NOT persist to the
 * config YAML. After switching it runs a cheap connectivity probe against the
 * new default so the caller learns immediately if the target is unreachable.
 */

import type { InstanceManager } from '../client/instance-manager.js';
import {
	SwitchDefaultInstanceOutputSchema,
	SwitchDefaultInstanceSchema,
} from '../schemas/instance-schemas.js';
import type { TableService } from '../services/table-service.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const SWITCH_DEFAULT_INSTANCE_TOOL = {
	name: 'servicenow_switch_default_instance',
	title: 'Switch default instance',
	description: `What: Change which configured instance receives calls that omit the 'instance' parameter, for the current session only.
When to use: When you want subsequent tool calls to target a different instance without passing 'instance' on every call.
Preconditions: The named instance must already be configured (see servicenow_sdk_status / your config for available names). Read access is enough — this does not write to any instance.
Produces: The previous and new default instance names, plus a connectivity probe result (connectivityVerified + detail). This only changes the in-memory session default; it does NOT persist to the config YAML.

Example:
- instance="dev"`,
	inputSchema: SwitchDefaultInstanceSchema,
	outputSchema: SwitchDefaultInstanceOutputSchema,
};

export function createSwitchDefaultInstanceTool(
	instanceManager: InstanceManager,
	tableService: TableService,
) {
	return {
		...SWITCH_DEFAULT_INSTANCE_TOOL,
		handler: async (params: unknown) => {
			try {
				const validated = SwitchDefaultInstanceSchema.parse(params);
				const { instance } = validated;

				const previousDefault = instanceManager.getDefaultInstance();

				// Throws ServiceNowError if the instance is unknown — caught below and
				// surfaced via toolError with the list of available instances.
				instanceManager.setDefaultInstance(instance);

				logger.info(`Switched default instance`, {
					previousDefault,
					newDefault: instance,
				});

				// Cheap connectivity probe against the new default. A failure here does
				// NOT roll back the switch (it already happened) — we just report it.
				let connectivityVerified = false;
				let connectivityDetail: string | undefined;
				try {
					const rows = await tableService.queryRecords(
						'sys_properties',
						{ query: 'name=instance_name', fields: ['value'], limit: 1 },
						instance,
					);
					connectivityVerified = true;
					connectivityDetail = rows[0]?.value as string | undefined;
				} catch (probeError) {
					connectivityVerified = false;
					const msg = probeError instanceof Error ? probeError.message : String(probeError);
					connectivityDetail = `WARNING: connectivity probe failed: ${msg}`;
					logger.warn(`Connectivity probe failed after switching default instance`, {
						instance,
						error: msg,
					});
				}

				const response = {
					success: true,
					previousDefault,
					newDefault: instance,
					connectivityVerified,
					...(connectivityDetail !== undefined ? { connectivityDetail } : {}),
				};

				return {
					content: [{ type: 'text' as const, text: toolText(response) }],
					structuredContent: response,
				};
			} catch (error) {
				logger.error('Error switching default instance', error);
				return toolError(error, { operation: 'switch default instance' });
			}
		},
	};
}
