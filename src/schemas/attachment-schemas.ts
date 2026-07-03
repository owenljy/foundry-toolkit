/**
 * Zod schemas for Attachment API validation
 */

import { z } from 'zod';

/**
 * Schema for uploading an attachment
 */
export const UploadAttachmentSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  fileName: z
    .string()
    .min(1, 'File name is required')
    .max(100, 'File name cannot exceed 100 characters')
    .refine((name) => !name.includes('..') && !name.includes('/') && !name.includes('\\'), {
      message: 'File name cannot contain path separators',
    }),
  fileContent: z
    .string()
    .min(1, 'File content is required')
    .describe('Base64-encoded file content'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  recordSysId: z
    .string()
    .length(32, 'Record sys_id must be exactly 32 characters')
    .regex(/^[a-f0-9]{32}$/i, 'Record sys_id must be a valid hexadecimal string'),
});

export type UploadAttachmentInput = z.infer<typeof UploadAttachmentSchema>;

/**
 * Schema for downloading an attachment
 */
export const DownloadAttachmentSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  attachmentSysId: z
    .string()
    .length(32, 'Attachment sys_id must be exactly 32 characters')
    .regex(/^[a-f0-9]{32}$/i, 'Attachment sys_id must be a valid hexadecimal string'),
});

export type DownloadAttachmentInput = z.infer<typeof DownloadAttachmentSchema>;

/**
 * Schema for listing attachments on a record
 */
export const ListAttachmentsSchema = z.object({
  instance: z
    .string()
    .optional()
    .describe('ServiceNow instance name (optional, uses default instance if not specified)'),
  tableName: z
    .string()
    .min(1, 'Table name is required')
    .regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores'),
  recordSysId: z
    .string()
    .length(32, 'Record sys_id must be exactly 32 characters')
    .regex(/^[a-f0-9]{32}$/i, 'Record sys_id must be a valid hexadecimal string'),
});

export type ListAttachmentsInput = z.infer<typeof ListAttachmentsSchema>;
