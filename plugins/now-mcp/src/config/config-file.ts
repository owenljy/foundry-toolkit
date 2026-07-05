/**
 * Configuration File I/O
 * Loading and saving of the now-mcp YAML config, plus small helpers for
 * picking instances out of a loaded config.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import type { InstanceConfig, ServiceNowConfig } from '../types/instance.js';

/**
 * Resolve the config file path: SERVICENOW_CONFIG_PATH, else
 * ./config/sn-credential.yaml.
 */
export function getConfigPath(): string {
	if (process.env.SERVICENOW_CONFIG_PATH) {
		return process.env.SERVICENOW_CONFIG_PATH;
	}
	return resolve('config', 'sn-credential.yaml');
}

/**
 * Load configuration from file
 */
export function loadConfig(configPath?: string): ServiceNowConfig {
	const path = configPath || getConfigPath();

	if (!existsSync(path)) {
		throw new Error(`Configuration file not found: ${path}`);
	}

	try {
		const content = readFileSync(path, 'utf-8');
		// YAML is a superset of JSON, so this also parses legacy JSON configs.
		const config = yaml.load(content) as ServiceNowConfig;

		// Validate config
		if (!config?.instances || !Array.isArray(config.instances)) {
			throw new Error('Invalid configuration: missing instances array');
		}

		if (config.instances.length === 0) {
			throw new Error('Invalid configuration: no instances defined');
		}

		const defaultInstances = config.instances.filter((i: InstanceConfig) => i.default);
		if (defaultInstances.length !== 1) {
			throw new Error('Invalid configuration: exactly one instance must be marked as default');
		}

		return config;
	} catch (error) {
		if (error instanceof yaml.YAMLException) {
			throw new Error(`Invalid YAML in configuration file: ${error.message}`);
		}
		throw error;
	}
}

/**
 * Save configuration to file
 */
export function saveConfig(config: ServiceNowConfig, configPath?: string): void {
	const path = configPath || getConfigPath();

	// Validate before saving
	if (!config.instances || config.instances.length === 0) {
		throw new Error('Cannot save empty configuration');
	}

	const defaultInstances = config.instances.filter((i: InstanceConfig) => i.default);
	if (defaultInstances.length !== 1) {
		throw new Error('Exactly one instance must be marked as default');
	}

	writeFileSync(path, yaml.dump(config, { indent: 2, lineWidth: -1 }), 'utf-8');
}

/**
 * Check if configuration exists
 */
export function configExists(configPath?: string): boolean {
	const path = configPath || getConfigPath();
	return existsSync(path);
}

/**
 * Get instance by name
 */
export function getInstance(name: string, config: ServiceNowConfig): InstanceConfig | undefined {
	return config.instances.find((i) => i.name === name);
}

/**
 * Get default instance
 */
export function getDefaultInstance(config: ServiceNowConfig): InstanceConfig {
	const defaultInstance = config.instances.find((i) => i.default);
	if (!defaultInstance) {
		throw new Error('No default instance found');
	}
	return defaultInstance;
}
