/**
 * Write-operation audit log.
 *
 * Every mutating HTTP call (POST/PUT/PATCH/DELETE) is recorded so there is a
 * trail of what this server changed and where. Entries always go to the
 * logger (stderr); if SERVICENOW_AUDIT_LOG is set to a file path, a JSON line
 * per write is also appended there.
 */

import { appendFileSync } from 'fs';
import { logger } from './logger.js';

export interface WriteAuditEntry {
  timestamp: string;
  method: string;
  endpoint: string;
  host: string;
}

function hostOf(instanceUrl: string): string {
  try {
    return new URL(instanceUrl).host;
  } catch {
    return instanceUrl;
  }
}

/**
 * Record a write operation to the audit trail.
 */
export function recordWrite(method: string, endpoint: string, instanceUrl: string): void {
  const entry: WriteAuditEntry = {
    timestamp: new Date().toISOString(),
    method: method.toUpperCase(),
    endpoint,
    host: hostOf(instanceUrl),
  };

  logger.info(`[AUDIT] ${entry.method} ${entry.endpoint} @ ${entry.host}`);

  const auditFile = process.env.SERVICENOW_AUDIT_LOG;
  if (auditFile) {
    try {
      appendFileSync(auditFile, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (error) {
      // Never let auditing break the actual operation.
      logger.warn(`Failed to write audit log to ${auditFile}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
