/**
 * MCP tool for uploading attachments to ServiceNow records
 */

import { UploadAttachmentSchema } from '../schemas/attachment-schemas.js';
import { UploadAttachmentOutputSchema } from '../schemas/output-schemas.js';
import type { AttachmentService } from '../services/attachment-service.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const UPLOAD_ATTACHMENT_TOOL = {
	name: 'servicenow_upload_attachment',
	title: 'Upload attachment',
	description: `What: Attach a file to a ServiceNow record. File content is passed as a base64-encoded string.
When to use: To add a file to an existing record.
Preconditions: Write-enabled instance (readOnly: false); the target record must exist.
Produces: Attachment metadata (sys_id, size, content type).

Example:
- fileName="screenshot.png", fileContent="<base64>", tableName="incident", recordSysId="abc123..."`,
	inputSchema: UploadAttachmentSchema,
	outputSchema: UploadAttachmentOutputSchema,
};

export function createUploadAttachmentTool(attachmentService: AttachmentService) {
	return {
		...UPLOAD_ATTACHMENT_TOOL,
		handler: async (params: unknown) => {
			let tableName: string | undefined;
			try {
				// Validate input
				const validated = UploadAttachmentSchema.parse(params);
				tableName = validated.tableName;

				logger.info(`Uploading attachment ${validated.fileName}`, {
					table: validated.tableName,
					record: validated.recordSysId,
				});

				// Upload attachment
				const attachment = await attachmentService.uploadAttachment(
					validated.fileName,
					validated.fileContent,
					validated.tableName,
					validated.recordSysId,
					validated.instance,
				);

				// Format response for LLM
				const response = {
					success: true,
					message: `Successfully uploaded attachment ${validated.fileName}`,
					attachment: {
						sys_id: attachment.sys_id,
						file_name: attachment.file_name,
						size_bytes: attachment.size_bytes,
						content_type: attachment.content_type,
						table_name: attachment.table_name,
						table_sys_id: attachment.table_sys_id,
						created_on: attachment.sys_created_on,
					},
				};

				return {
					content: [
						{
							type: 'text' as const,
							text: toolText(response),
						},
					],
					structuredContent: response,
				};
			} catch (error) {
				logger.error('Error uploading attachment', error);
				return toolError(error, { table: tableName, operation: 'upload attachment' });
			}
		},
	};
}
