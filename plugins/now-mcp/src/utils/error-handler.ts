/**
 * Error handling utilities for transforming errors to MCP-friendly format
 */

import {
	AccessDeniedError,
	AuthenticationError,
	HttpError,
	NetworkError,
	NotFoundError,
	RateLimitError,
	ServerError,
	ServiceNowError,
	ValidationError,
} from '../types/errors.js';
import { type FailureContext, failureHints, renderHints } from './failure-enrichment.js';
import { logger } from './logger.js';
import { toolText } from './tool-response.js';

/** Shape of a ServiceNow Table/Stats API error response body. */
interface ServiceNowErrorBody {
	error?: { message?: string };
}

/**
 * Transforms an HTTP (non-2xx response) error into a ServiceNow-specific error.
 */
export function transformHttpError(error: HttpError): ServiceNowError {
	const { status, data } = error;
	const servicenowError = data as ServiceNowErrorBody | undefined;

	logger.debug('ServiceNow API error', {
		status,
		data: servicenowError,
	});

	// Handle specific HTTP status codes
	switch (status) {
		case 401:
			return new AuthenticationError(
				servicenowError?.error?.message || 'Authentication failed. Please check your credentials.',
				servicenowError,
			);
		case 403:
			return new AccessDeniedError(
				servicenowError?.error?.message || 'Access denied. Check roles and ACLs.',
				servicenowError,
			);

		case 404:
			return new NotFoundError(
				servicenowError?.error?.message || 'The requested resource was not found.',
				servicenowError,
			);

		case 429: {
			const retryAfter = error.headers['retry-after'];
			return new RateLimitError(
				servicenowError?.error?.message || 'Rate limit exceeded. Please try again later.',
				retryAfter ? parseInt(retryAfter, 10) : undefined,
				servicenowError,
			);
		}

		case 400:
			return new ValidationError(
				servicenowError?.error?.message || 'Invalid request. Please check your input parameters.',
				servicenowError,
			);

		case 500:
		case 502:
		case 503:
		case 504:
			return new ServerError(
				servicenowError?.error?.message ||
					'ServiceNow server error occurred. Please try again later.',
				servicenowError,
			);

		default:
			return new ServiceNowError(
				servicenowError?.error?.message || `ServiceNow API error: ${status}`,
				status,
				servicenowError,
				'API_ERROR',
			);
	}
}

/**
 * Transforms any error into a ServiceNowError
 */
export function transformError(error: unknown): ServiceNowError {
	if (error instanceof ServiceNowError) {
		return error;
	}

	if (error instanceof HttpError) {
		return transformHttpError(error);
	}

	if (error instanceof Error) {
		// Full stack goes to stderr via logger.error only — it's server-side
		// debugging detail (local file paths, node/dependency internals) that the
		// model can't act on. Duplicating it into `details` doubled the size of
		// every validation-error response (ZodError, the most common failure,
		// extends Error and landed here) for zero benefit to the caller.
		logger.error('Unexpected error', error);
		return new ServiceNowError(error.message, undefined, undefined, 'UNEXPECTED_ERROR');
	}

	logger.error('Unknown error type', { error });
	return new ServiceNowError('An unknown error occurred', undefined, error, 'UNKNOWN_ERROR');
}

/**
 * Formats an error for MCP tool response. Just the structured error — recovery
 * guidance is attached separately (and once) by toolError via failureHints,
 * which is context-aware (knows the table/operation) and points at specific
 * tools. The old static `suggestions[]` + `documentation` fields were dropped:
 * they duplicated failureHints with more, vaguer text on every error.
 */
export function formatErrorForTool(error: unknown): string {
	const servicenowError = transformError(error);
	return toolText(servicenowError.toJSON());
}

/**
 * Build a standard MCP error tool-result: the formatted error text, plus
 * recovery hints (403/404/field-error guidance) when the context yields any.
 * Centralizes the catch-block boilerplate every tool otherwise repeats.
 */
export function toolError(error: unknown, ctx: FailureContext = {}) {
	// Prefer the structured status code over text matching — ServiceNow's own
	// error.message (e.g. "User Not Authorized") doesn't reliably contain the
	// status code or a recognizable keyword.
	const statusCode =
		ctx.statusCode ?? (error instanceof ServiceNowError ? error.statusCode : undefined);
	const hints = renderHints(failureHints(String(error), { ...ctx, statusCode }));
	return {
		content: [
			{ type: 'text' as const, text: formatErrorForTool(error) },
			...(hints ? [{ type: 'text' as const, text: hints }] : []),
		],
		isError: true as const,
	};
}

/**
 * Determines if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof NetworkError) {
		return true;
	}

	if (error instanceof RateLimitError) {
		return true;
	}

	if (error instanceof ServerError) {
		return true;
	}

	if (error instanceof HttpError) {
		// Retry on rate-limit or 5xx status codes
		return error.status === 429 || error.status >= 500;
	}

	return false;
}
