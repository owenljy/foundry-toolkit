import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Ask the user to confirm a destructive operation via the MCP elicitation
 * protocol. Returns true if the user accepted, false if they declined/cancelled.
 *
 * Fails open: if the client does not support elicitation (older clients, raw
 * stdio without a UI) the call throws and we return true so the operation
 * proceeds. The description-text WARNING on the tool remains the fallback signal.
 */
export async function elicitConfirmation(server: Server, message: string): Promise<boolean> {
	try {
		const result = await server.elicitInput({
			message,
			requestedSchema: {
				type: 'object' as const,
				properties: {
					confirmed: {
						type: 'boolean' as const,
						title: 'Confirm',
						description: message,
					},
				},
				required: ['confirmed'],
			},
		});
		return result.action === 'accept' && result.content?.['confirmed'] === true;
	} catch {
		// Client doesn't support elicitation — proceed without confirmation.
		return true;
	}
}

interface ToolResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
}

/** Return value for a tool call that was cancelled by the user. */
export function toolAborted(reason: string): ToolResult {
	return {
		content: [{ type: 'text' as const, text: reason }],
	};
}
