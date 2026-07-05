/**
 * Zod schemas for batch operations validation
 */

import { z } from 'zod';
import { maxBatchSize } from '../config/batch-config.js';

/**
 * Enforce the configured max-batch-size cap at parse time, reporting the actual
 * resolved limit (which an operator can raise via SERVICENOW_MAX_BATCH_SIZE)
 * rather than a hardcoded number. Applied via superRefine so the message stays
 * accurate even when the env override changes the cap.
 */
function enforceBatchSize(items: unknown[], ctx: z.RefinementCtx): void {
  const cap = maxBatchSize();
  if (items.length > cap) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: cap,
      type: 'array',
      inclusive: true,
      message: `Cannot process more than ${cap} records at once (set SERVICENOW_MAX_BATCH_SIZE to change this).`,
    });
  }
}

/**
 * Schema for batch creating multiple records
 */
export const BatchCreateSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  records: z
    .array(
      z.record(z.unknown()).refine((data) => Object.keys(data).length > 0, {
        message: 'Each record must have at least one field',
      }),
    )
    .min(1, 'At least one record is required')
    .superRefine(enforceBatchSize)
    .describe('Array of record objects to create'),
  continueOnError: z
    .boolean()
    .default(true)
    .describe(
      'If true (default), keep creating remaining records after a failure. If false, stop before the next concurrency batch once any record fails — records already dispatched in the current batch (up to 25) still complete.',
    ),
  skipFieldValidation: z
    .boolean()
    .optional()
    .describe(
      'Skip the pre-flight field-name validation against the table schema (e.g. for a field not present in the cached dictionary)',
    ),
});

export type BatchCreateInput = z.infer<typeof BatchCreateSchema>;

/**
 * Schema for batch updating multiple records
 */
export const BatchUpdateSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  updates: z
    .array(
      z.object({
        sysId: z
          .string()
          .length(32, 'sys_id must be exactly 32 characters')
          .regex(/^[a-f0-9]{32}$/i, 'sys_id must be a valid hexadecimal string'),
        fields: z.record(z.unknown()).refine((data) => Object.keys(data).length > 0, {
          message: 'Fields object must have at least one field',
        }),
      }),
    )
    .min(1, 'At least one update is required')
    .superRefine(enforceBatchSize)
    .describe('Array of update objects with sysId and fields'),
  updateType: z
    .enum(['partial', 'full'])
    .default('partial')
    .describe('partial = PATCH (update only provided fields), full = PUT (replace entire record)'),
  continueOnError: z
    .boolean()
    .default(true)
    .describe(
      'If true (default), keep updating remaining records after a failure. If false, stop before the next concurrency batch once any record fails — records already dispatched in the current batch (up to 25) still complete.',
    ),
  skipFieldValidation: z
    .boolean()
    .optional()
    .describe(
      'Skip the pre-flight field-name validation against the table schema (e.g. for a field not present in the cached dictionary)',
    ),
});

export type BatchUpdateInput = z.infer<typeof BatchUpdateSchema>;

/**
 * Response type for batch operations
 */
export interface BatchOperationResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  results: Array<{
    index: number;
    success: boolean;
    sysId?: string;
    record?: unknown;
    error?: string;
  }>;
}
