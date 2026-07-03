/**
 * Schema discovery service for introspecting ServiceNow table structures
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { InstanceManager } from '../client/instance-manager.js';
import { logger } from '../utils/logger.js';
import { validateFieldNames, type FieldValidationResult } from '../utils/field-validation.js';
import { closestMatch } from '../utils/levenshtein.js';
import { assertTableAllowed } from '../utils/table-access.js';
import type { TableMetadata, FieldMetadata, TableListItem } from '../schemas/schema-schemas.js';

// ServiceNow reference fields can come back as a plain string (sys_id or name)
// or as a {value, display_value, link} object depending on instance config.
function normalizeSNRef(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val || undefined;
  if (typeof val === 'object' && val !== null) {
    const o = val as { display_value?: string; value?: string };
    return o.display_value || o.value || undefined;
  }
  return undefined;
}

/**
 * Cache configuration for schema data
 */
const CACHE_TTL = 15 * 60 * 1000; // in-memory (L1) TTL: 15 minutes
// Disk (L2) TTL: survives restarts so field validation works immediately.
const DISK_CACHE_TTL =
  parseInt(process.env.SERVICENOW_SCHEMA_CACHE_TTL || '', 10) || 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

function schemaCacheDir(): string {
  return (
    process.env.SERVICENOW_SCHEMA_CACHE_DIR || join(homedir(), '.now-mcp', 'schema-cache')
  );
}

export class SchemaService {
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  constructor(private instanceManager: InstanceManager) {}

  /**
   * Validate a set of field names against a table's schema, returning unknown
   * fields with typo suggestions. Returns null if the schema can't be loaded
   * (e.g. no read access to sys_dictionary) so callers can skip gracefully.
   */
  async validateFields(
    tableName: string,
    fieldNames: string[],
    instance?: string,
  ): Promise<FieldValidationResult | null> {
    try {
      // Walk the inheritance chain so fields defined on parent tables (e.g.
      // `number` on `task`, inherited by `incident`) are included. Each table
      // schema is cached, so the walk only costs one API call per table.
      const known = new Set<string>();
      let current: string | undefined = tableName;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const schema = await this.getTableSchema(current, false, instance);
        for (const f of schema.fields) {
          if (f.name) known.add(f.name);
        }
        current = schema.extends;
      }
      if (known.size === 0) return null;
      return validateFieldNames(fieldNames, [...known]);
    } catch (error) {
      logger.debug(`Field validation skipped for ${tableName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Suggest the closest real table name to a (possibly typo'd) one. Used when a
   * table fails to resolve, to tell "typo'd table" apart from "no read access".
   * Returns undefined if nothing is close enough (or the name is exact — an
   * exact match means the table exists, so it's an access issue, not a typo).
   * The table-name list is fetched once and cached (disk, 24h).
   */
  async suggestTableName(tableName: string, instance?: string): Promise<string | undefined> {
    try {
      const cacheKey = `tablenames:${instance || 'default'}`;
      let names = this.getFromCache<string[]>(cacheKey);
      if (!names) {
        const client = this.instanceManager.getClient(instance);
        const resp = await client.get<{ result: Array<{ name: string }> }>(
          '/api/now/table/sys_db_object',
          { sysparm_fields: 'name', sysparm_limit: 10000 },
        );
        names = resp.result.map((r) => r.name).filter(Boolean);
        this.setCache(cacheKey, names);
      }
      return closestMatch(tableName, names);
    } catch (error) {
      logger.debug(`Table-name suggestion skipped for ${tableName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Get detailed schema information for a table
   * @param tableName Name of the table
   * @param includeExtended Include fields from parent tables
   * @param instance Optional instance name
   */
  async getTableSchema(
    tableName: string,
    includeExtended: boolean = false,
    instance?: string,
  ): Promise<TableMetadata> {
    // Defense-in-depth: schema discovery bypasses validateTableName, so gate it
    // here too — a blocked table's structure shouldn't be readable either.
    assertTableAllowed(tableName);
    const cacheKey = `schema:${instance || 'default'}:${tableName}:${includeExtended}`;

    // Check cache first
    const cached = this.getFromCache<TableMetadata>(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for table schema: ${tableName}`);
      // Disk cache may predate the normalization fix — re-normalize on the way out.
      cached.extends = normalizeSNRef(cached.extends);
      return cached;
    }

    logger.info(`Fetching table schema: ${tableName}`, {
      instance: instance || 'default',
      includeExtended,
    });

    const client = this.instanceManager.getClient(instance);

    // Query sys_dictionary table for field definitions
    const query = includeExtended
      ? `name=${tableName}`
      : `name=${tableName}^internal_type!=collection`;

    // The field definitions (sys_dictionary) and the table metadata
    // (sys_db_object) are independent reads — fetch them concurrently so the
    // tool's latency is one round-trip, not two back-to-back.
    const [response, tableResponse] = await Promise.all([
      client.get<{
        result: Array<{
          element: string;
          column_label: string;
          internal_type: string;
          mandatory: string;
          read_only: string;
          max_length: string;
          reference: string;
        }>;
      }>('/api/now/table/sys_dictionary', {
        sysparm_query: query,
        sysparm_fields:
          'element,column_label,internal_type,mandatory,read_only,max_length,reference',
        sysparm_limit: 1000,
      }),
      client.get<{
        result: Array<{
          name: string;
          label: string;
          'super_class.name': string;
        }>;
      }>('/api/now/table/sys_db_object', {
        sysparm_query: `name=${tableName}`,
        sysparm_fields: 'name,label,super_class.name',
        sysparm_limit: 1,
      }),
    ]);

    const fields: FieldMetadata[] = response.result.map((field) => ({
      name: field.element,
      label: field.column_label,
      type: field.internal_type,
      mandatory: field.mandatory === 'true',
      readOnly: field.read_only === 'true',
      maxLength: field.max_length ? parseInt(field.max_length, 10) : undefined,
      reference: field.reference || undefined,
    }));

    const tableInfo = tableResponse.result[0];

    const metadata: TableMetadata = {
      name: tableName,
      label: tableInfo?.label || tableName,
      extends: normalizeSNRef(tableInfo?.['super_class.name']),
      fields,
      // A table that exists has a sys_db_object row; absent/unreadable does not.
      exists: Boolean(tableInfo) || fields.length > 0,
    };

    // Cache the result
    this.setCache(cacheKey, metadata);

    logger.info(`Retrieved ${fields.length} fields for table ${tableName}`);

    return metadata;
  }

  /**
   * List all available tables
   * @param filter Optional filter for table names
   * @param limit Maximum number of tables to return
   * @param instance Optional instance name
   */
  async listTables(
    filter?: string,
    limit: number = 100,
    instance?: string,
  ): Promise<TableListItem[]> {
    const cacheKey = `tables:${instance || 'default'}:${filter || 'all'}:${limit}`;

    // Check cache first
    const cached = this.getFromCache<TableListItem[]>(cacheKey);
    if (cached) {
      logger.debug('Cache hit for table list');
      return cached;
    }

    logger.info('Fetching table list', {
      instance: instance || 'default',
      filter,
      limit,
    });

    const client = this.instanceManager.getClient(instance);

    // Build query for filtering. Honor leading/trailing `*` as anchors:
    //   incident*  -> STARTSWITH   *incident -> ENDSWITH
    //   *incident* / incident -> LIKE (substring)
    let query = 'sys_class_name=sys_db_object';
    if (filter) {
      const hasLead = filter.startsWith('*');
      const hasTrail = filter.endsWith('*');
      const core = filter.replace(/^\*+/, '').replace(/\*+$/, '');
      if (core) {
        if (hasTrail && !hasLead) {
          query += `^nameSTARTSWITH${core}`;
        } else if (hasLead && !hasTrail) {
          query += `^nameENDSWITH${core}`;
        } else {
          query += `^nameLIKE${core}`;
        }
      }
    }

    const response = await client.get<{
      result: Array<{
        name: string;
        label: string;
        'super_class.name': string;
      }>;
    }>('/api/now/table/sys_db_object', {
      sysparm_query: query,
      sysparm_fields: 'name,label,super_class.name',
      sysparm_limit: limit,
      sysparm_order_by: 'name',
    });

    const tables: TableListItem[] = response.result.map((table) => ({
      name: table.name,
      label: table.label,
      extends: normalizeSNRef(table['super_class.name']),
    }));

    // Cache the result
    this.setCache(cacheKey, tables);

    logger.info(`Retrieved ${tables.length} tables`);

    return tables;
  }

  /**
   * Get choice list values for a specific field
   * @param tableName Name of the table
   * @param fieldName Name of the field
   * @param instance Optional instance name
   */
  async getChoiceList(
    tableName: string,
    fieldName: string,
    instance?: string,
  ): Promise<Array<{ label: string; value: string }>> {
    assertTableAllowed(tableName);
    const cacheKey = `choices:${instance || 'default'}:${tableName}:${fieldName}`;

    // Check cache first
    const cached = this.getFromCache<Array<{ label: string; value: string }>>(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for choice list: ${tableName}.${fieldName}`);
      return cached;
    }

    logger.info(`Fetching choice list: ${tableName}.${fieldName}`, {
      instance: instance || 'default',
    });

    const client = this.instanceManager.getClient(instance);

    const response = await client.get<{
      result: Array<{
        label: string;
        value: string;
        sequence: string;
      }>;
    }>('/api/now/table/sys_choice', {
      sysparm_query: `name=${tableName}^element=${fieldName}^inactive=false`,
      sysparm_fields: 'label,value,sequence',
      sysparm_order_by: 'sequence',
      sysparm_limit: 500,
    });

    const choices = response.result.map((choice) => ({
      label: choice.label,
      value: choice.value,
    }));

    // Cache the result
    this.setCache(cacheKey, choices);

    logger.info(`Retrieved ${choices.length} choices for ${tableName}.${fieldName}`);

    return choices;
  }

  /**
   * Get data from cache if not expired (L1 in-memory, then L2 disk).
   */
  private getFromCache<T>(key: string): T | null {
    const now = Date.now();

    const entry = this.cache.get(key);
    if (entry) {
      if (now - entry.timestamp <= CACHE_TTL) {
        return entry.data as T;
      }
      this.cache.delete(key);
    }

    // L2: disk cache (survives restarts, longer TTL)
    const disk = this.readDisk<T>(key, now);
    if (disk !== null) {
      // Promote back into memory
      this.cache.set(key, { data: disk, timestamp: now });
      return disk;
    }

    return null;
  }

  /**
   * Store data in cache (in-memory + disk write-through).
   */
  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
    this.writeDisk(key, data);
  }

  private diskPath(key: string): string {
    const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);
    return join(schemaCacheDir(), `${hash}.json`);
  }

  private readDisk<T>(key: string, now: number): T | null {
    try {
      const path = this.diskPath(key);
      if (!existsSync(path)) return null;
      const entry = JSON.parse(readFileSync(path, 'utf-8')) as CacheEntry<T>;
      if (now - entry.timestamp > DISK_CACHE_TTL) return null;
      return entry.data;
    } catch {
      return null;
    }
  }

  private writeDisk<T>(key: string, data: T): void {
    try {
      const dir = schemaCacheDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.diskPath(key), JSON.stringify({ data, timestamp: Date.now() }), 'utf-8');
    } catch (error) {
      // Caching is best-effort; never break a schema read because of disk I/O.
      logger.debug('Schema disk cache write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Schema cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
