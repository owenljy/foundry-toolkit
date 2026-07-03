/**
 * Instance Manager for handling multiple ServiceNow instances
 */

import { ServiceNowClient } from './servicenow-client.js';
import { InstanceConfig, InstanceStatus } from '../types/instance.js';
import { logger } from '../utils/logger.js';
import { ServiceNowError } from '../types/errors.js';

/**
 * Manages multiple ServiceNow client instances
 */
export class InstanceManager {
  private clients: Map<string, ServiceNowClient> = new Map();
  private configs: Map<string, InstanceConfig> = new Map();
  private defaultInstance: string;

  /**
   * Creates a new InstanceManager
   * @param instances Array of instance configurations
   * @throws {ServiceNowError} If no default instance is specified or instance names are not unique
   */
  constructor(instances: InstanceConfig[]) {
    if (instances.length === 0) {
      throw new ServiceNowError('At least one instance configuration is required', 400);
    }

    // Validate unique instance names
    const names = instances.map((i) => i.name);
    const uniqueNames = new Set(names);
    if (names.length !== uniqueNames.size) {
      throw new ServiceNowError('Instance names must be unique', 400);
    }

    // Find default instance
    const defaultInstances = instances.filter((i) => i.default);
    if (defaultInstances.length === 0) {
      throw new ServiceNowError('Exactly one instance must be marked as default', 400);
    }
    if (defaultInstances.length > 1) {
      throw new ServiceNowError('Only one instance can be marked as default', 400);
    }

    this.defaultInstance = defaultInstances[0].name;

    // Initialize clients for each instance
    for (const config of instances) {
      try {
        const client = new ServiceNowClient(config.url, config.auth, (config.timeout ?? 30) * 1000);

        this.clients.set(config.name, client);
        this.configs.set(config.name, config);

        logger.info(`Initialized ServiceNow instance: ${config.name}`, {
          url: config.url,
          authType: config.auth.type,
          default: config.default,
        });
      } catch (error) {
        logger.error(`Failed to initialize instance ${config.name}`, { error });
        throw new ServiceNowError(
          `Failed to initialize instance ${config.name}: ${error instanceof Error ? error.message : String(error)}`,
          500,
        );
      }
    }
  }

  /**
   * Get a ServiceNow client for a specific instance
   * @param instanceName Optional instance name. If not provided, returns the default instance
   * @returns ServiceNowClient for the specified instance
   * @throws {ServiceNowError} If the instance name is invalid
   */
  getClient(instanceName?: string): ServiceNowClient {
    const name = instanceName || this.defaultInstance;

    const client = this.clients.get(name);
    if (!client) {
      const availableInstances = Array.from(this.clients.keys()).join(', ');
      throw new ServiceNowError(
        `Instance '${name}' not found. Available instances: ${availableInstances}`,
        400,
      );
    }

    return client;
  }

  /**
   * Get the configuration for a specific instance
   * @param instanceName Optional instance name. If not provided, returns the default instance config
   * @returns InstanceConfig for the specified instance
   */
  getConfig(instanceName?: string): InstanceConfig {
    const name = instanceName || this.defaultInstance;
    const config = this.configs.get(name);

    if (!config) {
      throw new ServiceNowError(`Instance '${name}' not found`, 400);
    }

    return config;
  }

  /**
   * List all available instance names
   * @returns Array of instance names
   */
  listInstances(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get the default instance name
   * @returns Name of the default instance
   */
  getDefaultInstance(): string {
    return this.defaultInstance;
  }

  /**
   * Check if an instance exists
   * @param instanceName Instance name to check
   * @returns True if instance exists, false otherwise
   */
  hasInstance(instanceName: string): boolean {
    return this.clients.has(instanceName);
  }

  /**
   * Switch the in-memory default instance for the current session.
   * Persistence to the YAML is handled separately by the caller.
   * @param instanceName Name of a managed instance to make default
   * @throws {ServiceNowError} If the instance name is not managed
   */
  setDefaultInstance(instanceName: string): void {
    if (!this.clients.has(instanceName)) {
      const available = Array.from(this.clients.keys()).join(', ');
      throw new ServiceNowError(
        `Instance '${instanceName}' not found. Available instances: ${available}`,
        400,
      );
    }
    this.defaultInstance = instanceName;
  }

  /**
   * Validate connections to all instances
   * @returns Array of instance statuses
   */
  async validateConnections(): Promise<InstanceStatus[]> {
    // Probe every instance concurrently — a slow/unreachable one shouldn't
    // serialize behind the others (total time becomes max, not sum, of probes).
    return Promise.all(
      Array.from(this.clients.entries()).map(async ([name, client]) => {
        const status: InstanceStatus = {
          name,
          connected: false,
          lastChecked: new Date(),
        };

        try {
          // Lightweight query to sys_user (limit 1) just to confirm reachability.
          await client.query('sys_user', '', 1, 0);
          status.connected = true;
          logger.info(`Connection validated for instance: ${name}`);
        } catch (error) {
          status.connected = false;
          status.error = error instanceof Error ? error.message : String(error);
          logger.warn(`Connection validation failed for instance: ${name}`, {
            error: status.error,
          });
        }

        return status;
      }),
    );
  }

  /**
   * Get the total number of managed instances
   * @returns Number of instances
   */
  getInstanceCount(): number {
    return this.clients.size;
  }
}
