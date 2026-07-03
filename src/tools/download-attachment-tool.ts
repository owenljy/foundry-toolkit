/**
 * MCP tool for downloading attachments from ServiceNow
 */

import { AttachmentService } from '../services/attachment-service.js';
import { DownloadAttachmentSchema } from '../schemas/attachment-schemas.js';
import { DownloadAttachmentOutputSchema } from '../schemas/output-schemas.js';
import { toolError } from '../utils/error-handler.js';
import { logger } from '../utils/logger.js';
import { toolText } from '../utils/tool-response.js';

export const DOWNLOAD_ATTACHMENT_TOOL = {
  name: 'servicenow_download_attachment',
  title: 'Download attachment',
  description: `What: Download a file attachment by its sys_id. Content is returned base64-encoded.
When to use: To retrieve an attached file's bytes.
Preconditions: Read access; the attachment sys_id must exist. Downloads over ~10MB are rejected (raise SERVICENOW_MAX_DOWNLOAD_BYTES).
Produces: file name, content type, size, and base64 content. The base64 is in structuredContent.attachment.file_content (the text summary omits it to save context) — read it from there.

Example:
- attachmentSysId="abc123..."`,
  inputSchema: DownloadAttachmentSchema,
  outputSchema: DownloadAttachmentOutputSchema,
};

export function createDownloadAttachmentTool(attachmentService: AttachmentService) {
  return {
    ...DOWNLOAD_ATTACHMENT_TOOL,
    handler: async (params: unknown) => {
      try {
        // Validate input
        const validated = DownloadAttachmentSchema.parse(params);

        logger.info(`Downloading attachment ${validated.attachmentSysId}`);

        // Download attachment
        const result = await attachmentService.downloadAttachment(
          validated.attachmentSysId,
          validated.instance,
        );

        // The base64 content can be megabytes — it belongs ONLY in
        // structuredContent (not char-capped). The text block carries just the
        // metadata, so it never gets truncated mid-string into an undecodable
        // blob by the tool-text renderer.
        const response = {
          success: true,
          message: `Successfully downloaded attachment ${result.fileName}`,
          attachment: {
            file_name: result.fileName,
            file_content: result.fileContent,
            content_type: result.contentType,
            size_bytes: result.size,
          },
        };

        const textSummary = {
          success: true,
          message: response.message,
          attachment: {
            file_name: result.fileName,
            content_type: result.contentType,
            size_bytes: result.size,
            file_content: `<${result.size} bytes base64 — see structuredContent.attachment.file_content>`,
          },
        };

        return {
          content: [
            {
              type: 'text' as const,
              text: toolText(textSummary),
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        logger.error('Error downloading attachment', error);
        return toolError(error, { operation: 'download attachment' });
      }
    },
  };
}
