/**
 * Zod schemas for instance-management tools.
 */

import { z } from 'zod';

/**
 * Schema for switching the session default instance.
 */
export const SwitchDefaultInstanceSchema = z.object({
	instance: z.string().describe('Name of a configured instance to make default for this session'),
});

export type SwitchDefaultInstanceInput = z.infer<typeof SwitchDefaultInstanceSchema>;

/**
 * Output schema for servicenow_switch_default_instance.
 */
export const SwitchDefaultInstanceOutputSchema = z.object({
	success: z.boolean(),
	previousDefault: z.string(),
	newDefault: z.string(),
	connectivityVerified: z.boolean(),
	connectivityDetail: z.string().optional(),
});
