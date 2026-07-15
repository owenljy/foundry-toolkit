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
 * Output schema for sn_switch_default_instance.
 */
export const SwitchDefaultInstanceOutputSchema = z.object({
	success: z.boolean(),
	previousDefault: z.string(),
	newDefault: z.string(),
	connectivityVerified: z.boolean(),
	connectivityDetail: z.string().optional(),
});

export const ConnectionStatusSchema = z.object({
	instance: z.string().min(1).optional().describe('Instance name; omit to inspect every instance'),
});

export const ResetConnectionSchema = z.object({
	instance: z
		.string()
		.min(1)
		.optional()
		.describe('Instance name; omit to reset the default instance'),
});

const BreakerStatusSchema = z.object({
	name: z.string(),
	url: z.string(),
	authType: z.enum(['basic', 'oauth']),
	state: z.enum(['closed', 'open', 'half-open']),
	failureScore: z.number(),
	authFailureScore: z.number(),
	openedReason: z
		.enum(['repeated_authentication_failures', 'repeated_transient_failures'])
		.optional(),
	lastFailureAt: z.number().optional(),
	retryAfterMs: z.number(),
});

export const ConnectionStatusOutputSchema = z.object({
	success: z.literal(true),
	instances: z.array(BreakerStatusSchema.extend({ isDefault: z.boolean() })),
});

export const ResetConnectionOutputSchema = z.object({
	success: z.literal(true),
	connection: BreakerStatusSchema,
	note: z.string(),
});
