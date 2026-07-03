/**
 * Table API service for CRUD operations on ServiceNow tables
 */

import { InstanceManager } from '../client/instance-manager.js';
import { API_ENDPOINTS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import {
  validateTableName,
  validateSysId,
  validatePagination,
  sanitizeQuery,
  validateWriteAccess,
} from '../utils/validators.js';
import type {
  ServiceNowRecord,
  TableAPIResponse,
  SingleRecordResponse,
  QueryOptions,
  AggregateOptions,
  RecordData,
} from '../types/servicenow.js';

/** Parse ServiceNow's X-Total-Count header into a number, or null if absent/NaN. */
function parseTotalCount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export class TableService {
  constructor(private instanceManager: InstanceManager) {}

  /**
   * Query records from a ServiceNow table
   * @param tableName Name of the table to query
   * @param options Query options (filters, pagination, fields, etc.)
   * @param instance Optional instance name (uses default if not specified)
   */
  async queryRecords<T extends ServiceNowRecord = ServiceNowRecord>(
    tableName: string,
    options: QueryOptions = {},
    instance?: string,
  ): Promise<T[]> {
    const { records } = await this.queryRecordsWithMeta<T>(tableName, options, instance);
    return records;
  }

  /**
   * Query records and also report the total number of rows matching the query
   * (from the ServiceNow `X-Total-Count` header), independent of pagination.
   * Lets a caller compute a reliable `hasMore` instead of guessing from the
   * fetched page size.
   * @returns records for the requested page, plus totalCount (null if the
   *          instance did not return the header).
   */
  async queryRecordsWithMeta<T extends ServiceNowRecord = ServiceNowRecord>(
    tableName: string,
    options: QueryOptions = {},
    instance?: string,
  ): Promise<{ records: T[]; totalCount: number | null }> {
    validateTableName(tableName);
    validatePagination(options.limit, options.offset);

    const client = this.instanceManager.getClient(instance);
    const endpoint = API_ENDPOINTS.TABLE_RECORD(tableName);

    // Build query parameters
    const params: Record<string, unknown> = {};

    if (options.query) {
      params.sysparm_query = sanitizeQuery(options.query);
    }

    if (options.limit !== undefined) {
      params.sysparm_limit = options.limit;
    }

    if (options.offset !== undefined) {
      params.sysparm_offset = options.offset;
    }

    if (options.fields && options.fields.length > 0) {
      params.sysparm_fields = options.fields.join(',');
    }

    if (options.displayValue !== undefined) {
      params.sysparm_display_value = options.displayValue;
    }

    if (options.excludeReferenceLink !== undefined) {
      params.sysparm_exclude_reference_link = options.excludeReferenceLink;
    }

    logger.debug(`Querying table: ${tableName}`, { params, instance: instance || 'default' });

    const { data, headers } = await client.getWithHeaders<TableAPIResponse<T>>(endpoint, params);
    const totalCount = parseTotalCount(headers['x-total-count']);

    logger.info(`Retrieved ${data.result.length} records from ${tableName}`, {
      instance: instance || 'default',
      totalCount,
    });

    return { records: data.result, totalCount };
  }

  /**
   * Aggregate records using the ServiceNow Stats API.
   * Computes counts and avg/sum/min/max over fields, optionally grouped, in a
   * single call — far cheaper than fetching raw rows and reducing client-side.
   * @param tableName Name of the table to aggregate
   * @param options Aggregation options (query, groupBy, count, *Fields, having)
   * @param instance Optional instance name (uses default if not specified)
   * @returns The raw Stats API `result` (an object, or an array of groups when
   *          groupBy is used).
   */
  async aggregateRecords(
    tableName: string,
    options: AggregateOptions = {},
    instance?: string,
  ): Promise<unknown> {
    validateTableName(tableName);

    const client = this.instanceManager.getClient(instance);
    const endpoint = API_ENDPOINTS.STATS(tableName);

    const params: Record<string, unknown> = {};

    if (options.query) {
      params.sysparm_query = sanitizeQuery(options.query);
    }
    if (options.count) {
      params.sysparm_count = true;
    }
    if (options.avgFields && options.avgFields.length > 0) {
      params.sysparm_avg_fields = options.avgFields.join(',');
    }
    if (options.sumFields && options.sumFields.length > 0) {
      params.sysparm_sum_fields = options.sumFields.join(',');
    }
    if (options.minFields && options.minFields.length > 0) {
      params.sysparm_min_fields = options.minFields.join(',');
    }
    if (options.maxFields && options.maxFields.length > 0) {
      params.sysparm_max_fields = options.maxFields.join(',');
    }
    if (options.groupBy && options.groupBy.length > 0) {
      params.sysparm_group_by = options.groupBy.join(',');
    }
    if (options.having) {
      params.sysparm_having = options.having;
    }
    if (options.orderBy) {
      params.sysparm_orderby = options.orderBy;
    }
    if (options.displayValue !== undefined) {
      params.sysparm_display_value = options.displayValue;
    }

    logger.debug(`Aggregating table: ${tableName}`, { params, instance: instance || 'default' });

    const response = await client.get<{ result: unknown }>(endpoint, params);

    logger.info(`Aggregated ${tableName}`, { instance: instance || 'default' });

    return response.result;
  }

  /**
   * Get a single record by sys_id
   * @param tableName Name of the table
   * @param sysId System ID of the record
   * @param fields Optional array of fields to retrieve
   * @param instance Optional instance name (uses default if not specified)
   */
  async getRecord<T extends ServiceNowRecord = ServiceNowRecord>(
    tableName: string,
    sysId: string,
    fields?: string[],
    instance?: string,
  ): Promise<T> {
    validateTableName(tableName);
    validateSysId(sysId);

    const client = this.instanceManager.getClient(instance);
    const endpoint = API_ENDPOINTS.TABLE_RECORD_BY_ID(tableName, sysId);

    const params: Record<string, unknown> = {};

    if (fields && fields.length > 0) {
      params.sysparm_fields = fields.join(',');
    }

    logger.debug(`Getting record: ${tableName}/${sysId}`, {
      params,
      instance: instance || 'default',
    });

    const response = await client.get<SingleRecordResponse<T>>(endpoint, params);

    logger.info(`Retrieved record ${sysId} from ${tableName}`, {
      instance: instance || 'default',
    });

    return response.result;
  }

  /**
   * Create a new record in a ServiceNow table
   * @param tableName Name of the table
   * @param data Field-value pairs for the new record
   * @param instance Optional instance name (uses default if not specified)
   */
  async createRecord<T extends ServiceNowRecord = ServiceNowRecord>(
    tableName: string,
    data: RecordData,
    instance?: string,
  ): Promise<T> {
    validateWriteAccess(this.instanceManager, instance);
    validateTableName(tableName);

    if (!data || Object.keys(data).length === 0) {
      throw new Error('Record data cannot be empty');
    }

    const client = this.instanceManager.getClient(instance);
    // Exclude reference-link URL metadata from the echoed row — it's noise for
    // the caller and bloats the returned record.
    const endpoint = `${API_ENDPOINTS.TABLE_RECORD(tableName)}?sysparm_exclude_reference_link=true`;

    logger.debug(`Creating record in ${tableName}`, { data, instance: instance || 'default' });

    const response = await client.post<SingleRecordResponse<T>>(endpoint, data);

    logger.info(`Created record ${response.result.sys_id} in ${tableName}`, {
      instance: instance || 'default',
    });

    return response.result;
  }

  /**
   * Update an existing record (partial or full update)
   * @param tableName Name of the table
   * @param sysId System ID of the record to update
   * @param data Field-value pairs to update
   * @param full Whether to perform a full update (PUT) or partial (PATCH)
   * @param instance Optional instance name (uses default if not specified)
   */
  async updateRecord<T extends ServiceNowRecord = ServiceNowRecord>(
    tableName: string,
    sysId: string,
    data: RecordData,
    full: boolean = false,
    instance?: string,
  ): Promise<T> {
    validateWriteAccess(this.instanceManager, instance);
    validateTableName(tableName);
    validateSysId(sysId);

    if (!data || Object.keys(data).length === 0) {
      throw new Error('Update data cannot be empty');
    }

    const client = this.instanceManager.getClient(instance);
    // Exclude reference-link URL metadata from the echoed row (see createRecord).
    const endpoint = `${API_ENDPOINTS.TABLE_RECORD_BY_ID(tableName, sysId)}?sysparm_exclude_reference_link=true`;

    logger.debug(`Updating record ${tableName}/${sysId}`, {
      data,
      updateType: full ? 'full' : 'partial',
      instance: instance || 'default',
    });

    const response = full
      ? await client.put<SingleRecordResponse<T>>(endpoint, data)
      : await client.patch<SingleRecordResponse<T>>(endpoint, data);

    logger.info(`Updated record ${sysId} in ${tableName}`, {
      instance: instance || 'default',
    });

    return response.result;
  }

  /**
   * Delete a record by sys_id
   * @param tableName Name of the table
   * @param sysId sys_id of the record to delete
   * @param instance Optional instance name (uses default if not specified)
   */
  async deleteRecord(
    tableName: string,
    sysId: string,
    instance?: string,
  ): Promise<{ success: boolean; message: string }> {
    validateWriteAccess(this.instanceManager, instance);
    validateTableName(tableName);
    validateSysId(sysId);

    const client = this.instanceManager.getClient(instance);
    const endpoint = API_ENDPOINTS.TABLE_RECORD_BY_ID(tableName, sysId);

    logger.info(`Deleting record ${tableName}/${sysId}`, {
      instance: instance || 'default',
    });

    await client.delete(endpoint);

    logger.info(`Deleted record ${sysId} from ${tableName}`, {
      instance: instance || 'default',
    });

    return {
      success: true,
      message: `Record ${sysId} deleted from ${tableName}`,
    };
  }
}
