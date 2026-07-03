/**
 * Zod schemas for schema discovery and introspection
 */

import { z } from 'zod';

/**
 * Schema for getting table schema/structure
 */
export const GetTableSchemaSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  includeExtended: z
    .boolean()
    .default(false)
    .describe('Include fields from parent tables (extended tables)'),
});

export type GetTableSchemaInput = z.infer<typeof GetTableSchemaSchema>;

/**
 * Schema for listing all available tables
 */
export const ListTablesSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  filter: z.string().optional().describe('Filter tables by name (supports wildcards with *)'),
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .default(100)
    .describe('Maximum number of tables to return'),
});

export type ListTablesInput = z.infer<typeof ListTablesSchema>;

/**
 * Schema for getting choice list values for a field
 */
export const GetChoiceListSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  fieldName: z
    .string()
    .min(1, 'Field name is required')
    .describe('Name of the field with choice list'),
});

export type GetChoiceListInput = z.infer<typeof GetChoiceListSchema>;

/**
 * Field metadata interface
 */
export interface FieldMetadata {
  name: string;
  label: string;
  type: string;
  mandatory: boolean;
  readOnly: boolean;
  maxLength?: number;
  reference?: string; // Referenced table name
  choices?: Array<{ label: string; value: string }>;
}

/**
 * Table metadata interface
 */
export interface TableMetadata {
  name: string;
  label: string;
  extends?: string; // Parent table name
  fields: FieldMetadata[];
  /** False when sys_db_object has no row for this name (table absent/unreadable). */
  exists: boolean;
}

/**
 * Table list item interface
 */
export interface TableListItem {
  name: string;
  label: string;
  extends?: string;
  numberOfRecords?: number;
}
