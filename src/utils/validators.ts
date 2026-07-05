/**
 * Input validation utilities
 */

import type { InstanceManager } from '../client/instance-manager.js';
import { AccessDeniedError, ValidationError } from '../types/errors.js';
import { assertTableAllowed } from './table-access.js';

/**
 * Validates a ServiceNow sys_id format (32-character hexadecimal)
 */
export function validateSysId(sysId: string): void {
	const sysIdPattern = /^[a-f0-9]{32}$/i;

	if (!sysIdPattern.test(sysId)) {
		throw new ValidationError(
			`Invalid sys_id format: "${sysId}". Expected 32-character hexadecimal string.`,
			{ sysId, expectedPattern: sysIdPattern.source },
		);
	}
}

/**
 * Validates a table name (basic validation)
 */
export function validateTableName(tableName: string): void {
	if (!tableName || tableName.trim().length === 0) {
		throw new ValidationError('Table name cannot be empty');
	}

	// Table names should only contain alphanumeric characters and underscores
	const tableNamePattern = /^[a-z0-9_]+$/i;

	if (!tableNamePattern.test(tableName)) {
		throw new ValidationError(
			`Invalid table name: "${tableName}". Table names should only contain letters, numbers, and underscores.`,
			{ tableName, expectedPattern: tableNamePattern.source },
		);
	}

	// Defense-in-depth: gate every table operation through the allow/deny lists.
	assertTableAllowed(tableName);
}

/**
 * Sanitizes an encoded query to prevent basic injection attempts
 * Note: ServiceNow's encoded queries are generally safe, but we add basic validation
 */
export function sanitizeQuery(query: string): string {
	if (!query) {
		return query;
	}

	// Remove any potentially dangerous characters
	// Encoded queries use: =, !=, ^, ^OR, ^NQ, LIKE, IN, etc.
	// We'll allow alphanumeric, spaces, and ServiceNow query operators
	const sanitized = query.trim();

	// Basic validation - check for obviously malicious patterns.
	// NOTE: we intentionally do NOT block "javascript:" — ServiceNow encoded
	// queries (and this server's natural-language translation) legitimately use
	// glide expressions like "javascript:gs.beginningOfToday()". The query is
	// sent as a REST query parameter, not rendered as HTML, so the XSS-oriented
	// patterns below are what matter.
	const dangerousPatterns = [
		/<script/gi,
		/on\w+\s*=/gi, // Event handlers like onclick=
		/eval\(/gi,
	];

	for (const pattern of dangerousPatterns) {
		if (pattern.test(sanitized)) {
			throw new ValidationError('Query contains potentially dangerous content', {
				query: sanitized,
			});
		}
	}

	return sanitized;
}

/**
 * Validates pagination parameters
 */
export function validatePagination(limit?: number, offset?: number): void {
	if (limit !== undefined) {
		if (limit < 1 || limit > 10000) {
			throw new ValidationError(`Invalid limit: ${limit}. Limit must be between 1 and 10000.`, {
				limit,
				min: 1,
				max: 10000,
			});
		}
	}

	if (offset !== undefined) {
		if (offset < 0) {
			throw new ValidationError(`Invalid offset: ${offset}. Offset must be 0 or greater.`, {
				offset,
				min: 0,
			});
		}
	}
}

/**
 * Validates file name for attachments
 */
export function validateFileName(fileName: string): void {
	if (!fileName || fileName.trim().length === 0) {
		throw new ValidationError('File name cannot be empty');
	}

	// Check for path traversal attempts
	if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
		throw new ValidationError(
			`Invalid file name: "${fileName}". File names cannot contain path separators or parent directory references.`,
			{ fileName },
		);
	}

	// Check for reasonable length (ServiceNow supports up to 100 characters)
	if (fileName.length > 100) {
		throw new ValidationError(
			`File name too long: "${fileName}". Maximum length is 100 characters.`,
			{ fileName, maxLength: 100 },
		);
	}
}

/**
 * Validates write access for a given instance
 * Throws AccessDeniedError if instance is configured as read-only
 * Note: readOnly defaults to true if not explicitly set to false
 */
export function validateWriteAccess(instanceManager: InstanceManager, instanceName?: string): void {
	const config = instanceManager.getConfig(instanceName);
	// Default to read-only (true) if not explicitly set to false
	const isReadOnly = config.readOnly !== false;

	if (isReadOnly) {
		throw new AccessDeniedError(
			`Write operations are not permitted on read-only instance '${config.name}'.`,
			{
				instance: config.name,
				operationType: 'write',
				readOnlyExplicit: config.readOnly === true,
				readOnlyDefault: config.readOnly === undefined,
				suggestion:
					'Set "readOnly": false in the instance configuration to enable write operations.',
			},
		);
	}
}
