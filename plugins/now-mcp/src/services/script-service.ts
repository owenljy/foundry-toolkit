/**
 * Script execution service for ServiceNow Scripted REST APIs
 */

import type { InstanceManager } from '../client/instance-manager.js';
import { ServiceNowError } from '../types/errors.js';
import { logger } from '../utils/logger.js';
import { validateWriteAccess } from '../utils/validators.js';

interface ScriptExecutionResult {
	success: boolean;
	output?: string;
	error?: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function phaseError(
	phase: string,
	method: string,
	endpoint: string,
	error: unknown,
	remediation?: string,
): ServiceNowError {
	const original = error instanceof ServiceNowError ? error : undefined;
	const suffix = remediation ? ` ${remediation}` : '';
	return new ServiceNowError(
		`Background-script ${phase} failed: ${method} ${endpoint}: ${errorMessage(error)}.${suffix}`,
		original?.statusCode,
		original?.servicenowError,
		'BACKGROUND_SCRIPT_TRANSPORT_ERROR',
	);
}

function parseScriptApiResponse(value: unknown, endpoint: string): ScriptExecutionResult {
	const result = (value as { result?: unknown } | null)?.result;
	if (
		typeof result !== 'object' ||
		result === null ||
		typeof (result as { success?: unknown }).success !== 'boolean'
	) {
		throw new ServiceNowError(
			`Background-script Scripted REST API returned an invalid response from POST ${endpoint}; expected { result: { success: boolean, output?: string, error?: string } }`,
			undefined,
			undefined,
			'BACKGROUND_SCRIPT_INVALID_RESPONSE',
		);
	}
	const typed = result as ScriptExecutionResult;
	if (typed.output !== undefined && typeof typed.output !== 'string') {
		throw new ServiceNowError(
			`Background-script Scripted REST API returned a non-string output from POST ${endpoint}`,
			undefined,
			undefined,
			'BACKGROUND_SCRIPT_INVALID_RESPONSE',
		);
	}
	if (typed.error !== undefined && typeof typed.error !== 'string') {
		throw new ServiceNowError(
			`Background-script Scripted REST API returned a non-string error from POST ${endpoint}`,
			undefined,
			undefined,
			'BACKGROUND_SCRIPT_INVALID_RESPONSE',
		);
	}
	return typed;
}

export class ScriptService {
	constructor(private instanceManager: InstanceManager) {}

	/**
	 * Execute arbitrary server-side JavaScript using sys_trigger
	 * WARNING: Requires elevated permissions (admin role)
	 * This method creates a temporary sys_trigger, executes it, retrieves output, and cleans up
	 *
	 * @param script JavaScript code to execute
	 * @param timeout Maximum execution time in milliseconds (default: 60000)
	 * @param instance Optional instance name (uses default if not specified)
	 * @returns Execution result including output and status
	 */
	async executeBackgroundScript(
		script: string,
		timeout: number = 60000,
		instance?: string,
	): Promise<{
		success: boolean;
		output?: string;
		error?: string;
		executionTime: number;
	}> {
		validateWriteAccess(this.instanceManager, instance);
		const client = this.instanceManager.getClient(instance);
		const config = this.instanceManager.getConfig(instance);
		const startTime = Date.now();

		logger.info('Executing background script', {
			scriptLength: script.length,
			timeout,
			instance: instance || 'default',
			path: config.scriptApiPath ? 'scripted-rest' : 'sys_trigger',
		});

		// Fast path: Scripted REST API executes synchronously without the scheduler.
		// Requires the companion REST API installed on the instance.
		// Expected contract: POST scriptApiPath {script} → {result: {success, output?, error?}}
		if (config.scriptApiPath) {
			try {
				const response = await client.post<unknown>(config.scriptApiPath, { script });
				const executionTime = Date.now() - startTime;
				const r = parseScriptApiResponse(response, config.scriptApiPath);
				logger.info('Background script completed via Scripted REST', {
					success: r.success,
					executionTime,
				});
				return { success: r.success, output: r.output, error: r.error, executionTime };
			} catch (error) {
				const executionTime = Date.now() - startTime;
				logger.error('Background script failed via Scripted REST', { error, executionTime });
				if (
					error instanceof ServiceNowError &&
					error.code === 'BACKGROUND_SCRIPT_INVALID_RESPONSE'
				) {
					throw error;
				}
				throw phaseError(
					'Scripted REST execution',
					'POST',
					config.scriptApiPath,
					error,
					'Verify that scriptApiPath matches an installed, active Scripted REST resource and that this user can execute it.',
				);
			}
		}

		try {
			// Fallback path: sys_trigger (requires active ServiceNow scheduler).
			//
			// Design: "Run Once" triggers (type 0) are DELETED by the scheduler after
			// execution, so we can't read results from the trigger record. Instead, use
			// sys_properties as a stable output mailbox that survives scheduler cleanup.
			//
			// Flow:
			//   1. Create sys_properties record (status=pending) as the output channel.
			//   2. Create Run Once sys_trigger whose script writes to that property.
			//   3. Poll the property record until status=done.
			//   4. Clean up the property (trigger is already gone after execution).

			const triggerName = `mcp_script_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			const propKey = `mcp.script.output.${triggerName}`;

			// Step 1: Create the sys_properties mailbox.
			const mailboxEndpoint = '/api/now/table/sys_properties';
			let propCreate: { result: { sys_id: string } };
			try {
				propCreate = await client.post<{ result: { sys_id: string } }>(mailboxEndpoint, {
					name: propKey,
					value: JSON.stringify({ status: 'pending' }),
					description: 'Temporary MCP background-script output buffer — safe to delete',
					type: 'string',
				});
			} catch (error) {
				throw phaseError(
					'mailbox creation',
					'POST',
					mailboxEndpoint,
					error,
					'The sys_trigger fallback requires Table API create/read/delete access to sys_properties. Configure a working scriptApiPath when protected system tables are not exposed.',
				);
			}
			const propSysId = propCreate.result.sys_id;
			if (!propSysId) {
				throw new ServiceNowError(
					`Background-script mailbox creation returned no sys_id from POST ${mailboxEndpoint}`,
					undefined,
					undefined,
					'BACKGROUND_SCRIPT_INVALID_RESPONSE',
				);
			}
			logger.debug(`Created sys_properties mailbox: ${propKey}`);

			// Step 2: Build and create the Run Once trigger.
			// gs is a Java-backed object in Rhino — assigning gs.log = function(){} silently
			// fails. Instead we define a log() helper in the wrapper scope and rewrite any
			// gs.log( / gs.info( / gs.print( calls in the user script to log() before inlining.
			// gs.print is a global-scope-only API (blocked/swallowed in scoped scripts), so we
			// normalize it here too — a user who pastes gs.print still gets captured output, and
			// the canonical scoped-safe call is gs.info (see the tool description's runtime contract).
			// sys_properties.value is limited to 4000 chars; truncate output to stay safe.
			const rewrittenScript = script
				.replace(/\bgs\.log\s*\(/g, 'log(')
				.replace(/\bgs\.info\s*\(/g, 'log(')
				.replace(/\bgs\.print\s*\(/g, 'log(');

			const wrappedScript = `
        (function() {
          var __key = '${propKey}';
          var __output = [];
          // log() is the output capture helper. gs.log/gs.info in the user script
          // have been rewritten to call this automatically.
          var log = function(msg) { var s = String(msg); __output.push(s); gs.log(s); };
          try {
            ${rewrittenScript}
            var __gr = new GlideRecord('sys_properties');
            if (__gr.get('name', __key)) {
              __gr.setValue('value', JSON.stringify({
                status: 'done', success: true,
                output: (function(){ var s = __output.join('\\n'); return s.length > 3900 ? s.substring(0, 3900) + '\\u2026[output truncated at 3900 chars]' : s; })()
              }));
              __gr.update();
            }
          } catch (e) {
            var __gr = new GlideRecord('sys_properties');
            if (__gr.get('name', __key)) {
              __gr.setValue('value', JSON.stringify({
                status: 'done', success: false,
                error: String(e).substring(0, 3900)
              }));
              __gr.update();
            }
          }
        })();
      `;

			const nowSN = new Date().toISOString().slice(0, 19).replace('T', ' ');
			const triggerEndpoint = '/api/now/table/sys_trigger';
			try {
				await client.post(triggerEndpoint, {
					name: triggerName,
					trigger_type: '0', // Run Once — scheduler picks up and deletes after execution
					next_action: nowSN,
					script: wrappedScript,
					active: true,
				});
			} catch (error) {
				// The trigger was never created, so remove the mailbox immediately.
				try {
					await client.delete(`${mailboxEndpoint}/${propSysId}`);
				} catch (cleanupError) {
					logger.warn('Failed to clean up mailbox after trigger creation failure', {
						propKey,
						error: cleanupError,
					});
				}
				throw phaseError(
					'trigger creation',
					'POST',
					triggerEndpoint,
					error,
					'The sys_trigger fallback requires Table API create access to sys_trigger. Configure a working scriptApiPath when this protected table is not exposed.',
				);
			}
			logger.debug(`Created sys_trigger (Run Once): ${triggerName}`);

			// Step 3: Poll sys_properties until status=done or timeout.
			const pollInterval = 500;
			const deadline = startTime + timeout;
			let result: { success: boolean; output?: string; error?: string } | null = null;

			while (Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, pollInterval));

				const pollEndpoint = `${mailboxEndpoint}/${propSysId}`;
				let propPoll: { result: { value: string } };
				try {
					propPoll = await client.get<{ result: { value: string } }>(pollEndpoint, {
						sysparm_fields: 'value',
					});
				} catch (error) {
					try {
						await client.delete(pollEndpoint);
					} catch (cleanupError) {
						logger.warn('Failed to clean up mailbox after polling failure', {
							propKey,
							error: cleanupError,
						});
					}
					throw phaseError('mailbox polling', 'GET', pollEndpoint, error);
				}

				try {
					const data = JSON.parse(propPoll.result.value);
					if (data.status === 'done') {
						result = data;
						break;
					}
				} catch {
					// Not valid JSON yet — keep polling
				}
			}

			// Step 4: Clean up sys_properties (trigger is already deleted by scheduler).
			try {
				await client.delete(`${mailboxEndpoint}/${propSysId}`);
				logger.debug(`Cleaned up sys_properties mailbox: ${propKey}`);
			} catch (cleanupError) {
				logger.warn('Failed to clean up sys_properties mailbox', { propKey, error: cleanupError });
			}

			const executionTime = Date.now() - startTime;

			if (!result) {
				logger.error('Background script execution timed out', { timeout, executionTime });
				return {
					success: false,
					error: `Script execution timed out after ${executionTime}ms. The sys_trigger (Run Once) was created but the ServiceNow scheduler did not execute it within the timeout. Check that the scheduler is running: System Diagnostics > Scheduler.`,
					executionTime,
				};
			}

			logger.info('Background script execution completed', {
				success: result.success,
				executionTime,
				instance: instance || 'default',
			});

			return {
				success: result.success,
				output: result.output,
				error: result.error,
				executionTime,
			};
		} catch (error) {
			const executionTime = Date.now() - startTime;
			logger.error('Background script execution failed', {
				error,
				executionTime,
				instance: instance || 'default',
			});
			throw error;
		}
	}
}
