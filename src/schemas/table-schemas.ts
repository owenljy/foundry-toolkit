/**
 * Zod schemas for Table API validation
 */

import { z } from 'zod';

/**
 * Schema for querying records from a ServiceNow table
 */
export const QueryRecordsSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  query: z.string().optional().describe('Encoded query string (e.g., "priority=1^state=2")'),
  limit: z
    .number()
    .int()
    .positive()
    // Request cap only. The rows actually returned are additionally capped by a
    // render guardrail in the query-records tool (row-count + serialized-size),
    // which truncates and signals `truncated` when a result would flood context.
    .max(10000, 'Limit cannot exceed 10000')
    .default(100)
    .describe('Maximum number of records to return (large results are truncated in the response)'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Number of records to skip for pagination'),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      'Specific fields to retrieve. Strongly prefer listing the fields you need — omitting this returns EVERY column, which on wide tables (e.g. incident) floods context and triggers result truncation.',
    ),
  displayValue: z
    .union([z.boolean(), z.literal('all')])
    .optional()
    .default(false)
    .describe('Return display values instead of actual values'),
  excludeReferenceLink: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Strip the API URL metadata from reference fields (default true). Keep true unless you specifically need the raw reference links — it removes noise and shrinks the result.',
    ),
});

export type QueryRecordsInput = z.infer<typeof QueryRecordsSchema>;

/**
 * Schema for aggregating records via the Stats API
 */
export const AggregateRecordsSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  query: z
    .string()
    .optional()
    .describe('Encoded query to filter rows before aggregating (e.g. "active=true^priority=1")'),
  count: z.boolean().optional().default(true).describe('Include a row count (default true)'),
  groupBy: z
    .array(z.string())
    .optional()
    .describe(
      'Fields to group by. Supports dot-walking, e.g. "assignment_group" or "caller_id.department"',
    ),
  avgFields: z.array(z.string()).optional().describe('Numeric fields to average'),
  sumFields: z.array(z.string()).optional().describe('Numeric fields to sum'),
  minFields: z.array(z.string()).optional().describe('Fields to take the minimum of'),
  maxFields: z.array(z.string()).optional().describe('Fields to take the maximum of'),
  having: z.string().optional().describe('Post-aggregation filter on an aggregate, e.g. "count>5"'),
  orderBy: z
    .string()
    .optional()
    .describe('Order groups by an aggregate (e.g. "count" or "DESCcount")'),
  displayValue: z
    .union([z.boolean(), z.literal('all')])
    .optional()
    .default(false)
    .describe('Return display values for group-by fields'),
});

export type AggregateRecordsInput = z.infer<typeof AggregateRecordsSchema>;

/**
 * Schema for getting a single record by sys_id
 */
export const GetRecordSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  sysId: z
    .string()
    .length(32, 'sys_id must be exactly 32 characters')
    .regex(/^[a-f0-9]{32}$/i, 'sys_id must be a valid hexadecimal string'),
  fields: z
    .array(z.string())
    .optional()
    .describe('Specific fields to retrieve (leave empty for all fields)'),
});

export type GetRecordInput = z.infer<typeof GetRecordSchema>;

/**
 * Schema for creating a new record
 */
export const CreateRecordSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  fields: z
    .record(z.unknown())
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided',
    })
    .describe('Field-value pairs for the new record'),
  skipFieldValidation: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Skip pre-flight field-name validation against the table schema (use if a valid field is being flagged)',
    ),
});

export type CreateRecordInput = z.infer<typeof CreateRecordSchema>;

/**
 * Schema for updating an existing record
 */
export const UpdateRecordSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  sysId: z
    .string()
    .length(32, 'sys_id must be exactly 32 characters')
    .regex(/^[a-f0-9]{32}$/i, 'sys_id must be a valid hexadecimal string'),
  fields: z
    .record(z.unknown())
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided',
    })
    .describe('Field-value pairs to update'),
  updateType: z
    .enum(['partial', 'full'])
    .default('partial')
    .describe('partial = PATCH (update only provided fields), full = PUT (replace entire record)'),
  skipFieldValidation: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Skip pre-flight field-name validation against the table schema (use if a valid field is being flagged)',
    ),
});

export type UpdateRecordInput = z.infer<typeof UpdateRecordSchema>;

/**
 * Schema for deleting a record
 */
export const DeleteRecordSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  sysId: z
    .string()
    .length(32, 'sys_id must be exactly 32 characters')
    .regex(/^[a-f0-9]{32}$/i, 'sys_id must be a valid hexadecimal string'),
});

export type DeleteRecordInput = z.infer<typeof DeleteRecordSchema>;
