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

/**
 * Schema for getting attachment metadata (no file content).
 * Either provide an attachmentSysId, or both tableName and recordSysId.
 */
export const GetAttachmentMetadataSchema = z
	.object({
		instance: z
			.string()
			.optional()
			.describe('ServiceNow instance name (optional, uses default instance if not specified)'),
		attachmentSysId: z
			.string()
			.length(32, 'Attachment sys_id must be exactly 32 characters')
			.regex(/^[a-f0-9]{32}$/i, 'Attachment sys_id must be a valid hexadecimal string')
			.optional(),
		tableName: z
			.string()
			.min(1, 'Table name is required')
			.regex(/^[a-z0-9_]+$/i, 'Table name should only contain letters, numbers, and underscores')
			.optional(),
		recordSysId: z
			.string()
			.length(32, 'Record sys_id must be exactly 32 characters')
			.regex(/^[a-f0-9]{32}$/i, 'Record sys_id must be a valid hexadecimal string')
			.optional(),
	})
	.refine((v) => v.attachmentSysId || (v.tableName && v.recordSysId), {
		message: 'Provide either attachmentSysId, or both tableName and recordSysId.',
	});

export type GetAttachmentMetadataInput = z.infer<typeof GetAttachmentMetadataSchema>;

/**
 * Output schema for get attachment metadata.
 * `attachments` holds the raw metadata objects (open by design); never file content.
 */
export const GetAttachmentMetadataOutputSchema = z.object({
	success: z.boolean(),
	totalAttachments: z.number(),
	attachments: z.array(z.record(z.unknown())),
});
