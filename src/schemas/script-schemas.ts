/**
 * Zod schemas for script execution validation
 */

import { z } from 'zod';

/**
 * Schema for executing arbitrary background scripts via sys_trigger
 */
export const ExecuteBackgroundScriptSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  script: z
    .string()
    .min(1, 'Script code is required')
    .describe('JavaScript code to execute on the server'),
  timeout: z
    .number()
    .min(1000, 'Timeout must be at least 1000ms')
    .max(120000, 'Timeout cannot exceed 120000ms (2 minutes)')
    .optional()
    .default(60000)
    .describe('Maximum execution time in milliseconds (default: 60000ms)'),
  allowWrites: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Permit write operations (insert/update/delete). Scripts containing writes are blocked by default — set this to true to explicitly approve execution. Writes to metadata/config tables are flagged separately in the response.',
    ),
});

export type ExecuteBackgroundScriptInput = z.infer<typeof ExecuteBackgroundScriptSchema>;
