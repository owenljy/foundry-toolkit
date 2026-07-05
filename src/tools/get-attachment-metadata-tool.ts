/**
 * MCP tool for getting attachment metadata from ServiceNow (no file content)
 */

import { AttachmentService } from '../services/attachment-service.js';
import {
  GetAttachmentMetadataSchema,
  GetAttachmentMetadataOutputSchema,
} from '../schemas/attachment-schemas.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const GET_ATTACHMENT_METADATA_TOOL = {
  name: 'servicenow_get_attachment_metadata',
  title: 'Get attachment metadata',
  description: `What: List attachment metadata (file name, content type, size, timestamps) without downloading any file bytes.
When to use: To discover what files are attached to a record and how big they are, before deciding whether to servicenow_download_attachment.
Preconditions: Read access. Provide either attachmentSysId (one attachment), or both tableName and recordSysId (all attachments on that record).
Produces: totalAttachments and an array of metadata objects (sys_id, file_name, content_type, size_bytes, table_name, table_sys_id, sys_created_on, sys_created_by). Never returns file content.

Examples:
- attachmentSysId="abc123..."
- tableName="incident", recordSysId="def456..."`,
  inputSchema: GetAttachmentMetadataSchema,
  outputSchema: GetAttachmentMetadataOutputSchema,
};

export function createGetAttachmentMetadataTool(attachmentService: AttachmentService) {
  return {
    ...GET_ATTACHMENT_METADATA_TOOL,
    handler: async (params: unknown) => {
      try {
        // Validate input
        const validated = GetAttachmentMetadataSchema.parse(params);

        logger.info('Getting attachment metadata', {
          instance: validated.instance || 'default',
        });

        // Fetch metadata: single attachment by sys_id, or all on a record.
        // The metadata objects are already the right shape — return them as-is.
        // Never include file content.
        const attachments = validated.attachmentSysId
          ? [
              await attachmentService.getAttachmentMetadata(
                validated.attachmentSysId,
                validated.instance,
              ),
            ]
          : await attachmentService.listAttachments(
              validated.tableName as string,
              validated.recordSysId as string,
              validated.instance,
            );

        const response = {
          success: true,
          totalAttachments: attachments.length,
          attachments,
        };

        return {
          content: [{ type: 'text' as const, text: toolText(response) }],
          structuredContent: response,
        };
      } catch (error) {
        logger.error('Error getting attachment metadata', error);
        return toolError(error, { operation: 'get attachment metadata' });
      }
    },
  };
}
