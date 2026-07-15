/**
 * Reads the plugin's own package.json so its version has a single source of
 * truth instead of being hardcoded a second time in server.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedVersion: string | undefined;

/**
 * Version string from package.json, resolved relative to this module so it's
 * correct wherever the plugin is installed.
 */
export function packageVersion(): string {
	if (cachedVersion !== undefined) {
		return cachedVersion;
	}
	// build/utils/package-info.js → plugin root is two levels up.
	const here = path.dirname(fileURLToPath(import.meta.url));
	const packageJsonPath = path.resolve(here, '..', '..', 'package.json');
	const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version: string };
	cachedVersion = pkg.version;
	return cachedVersion;
}
