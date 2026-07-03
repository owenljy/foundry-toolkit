import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resetConfig } from '../build/config/environment.js';

// The fast-path env vars this suite manipulates. Snapshot + restore so cases
// don't leak into each other or into other test files.
const FAST_PATH_VARS = [
  'SERVICENOW_CONFIG_PATH',
  'SERVICENOW_URL',
  'SERVICENOW_USERNAME',
  'SERVICENOW_PASSWORD',
  'SERVICENOW_READ_ONLY',
];

function clearFastPathEnv() {
  for (const v of FAST_PATH_VARS) delete process.env[v];
  resetConfig();
}

test('fast path: URL + username + password builds one default instance', () => {
  clearFastPathEnv();
  process.env.SERVICENOW_URL = 'https://dev123456.service-now.com';
  process.env.SERVICENOW_USERNAME = 'api.user';
  process.env.SERVICENOW_PASSWORD = 'secret';
  try {
    const cfg = loadConfig();
    assert.equal(cfg.instances.length, 1);
    const inst = cfg.instances[0];
    assert.equal(inst.name, 'dev123456'); // derived from host first label
    assert.equal(inst.url, 'https://dev123456.service-now.com');
    assert.equal(inst.default, true);
    assert.equal(inst.auth.type, 'basic');
    assert.equal(inst.auth.username, 'api.user');
    assert.equal(inst.auth.password, 'secret');
    assert.equal(inst.readOnly, true); // safe default when READ_ONLY unset
  } finally {
    clearFastPathEnv();
  }
});

test('fast path: SERVICENOW_READ_ONLY=false enables writes', () => {
  clearFastPathEnv();
  process.env.SERVICENOW_URL = 'https://dev123456.service-now.com';
  process.env.SERVICENOW_USERNAME = 'api.user';
  process.env.SERVICENOW_PASSWORD = 'secret';
  process.env.SERVICENOW_READ_ONLY = 'false';
  try {
    const cfg = loadConfig();
    assert.equal(cfg.instances[0].readOnly, false);
  } finally {
    clearFastPathEnv();
  }
});

test('fast path: unrecognized SERVICENOW_READ_ONLY fails safe to read-only and warns', () => {
  clearFastPathEnv();
  process.env.SERVICENOW_URL = 'https://dev123456.service-now.com';
  process.env.SERVICENOW_USERNAME = 'api.user';
  process.env.SERVICENOW_PASSWORD = 'secret';
  process.env.SERVICENOW_READ_ONLY = 'flase'; // typo for "false"

  const orig = console.error;
  let captured = '';
  console.error = (...a) => {
    captured += a.join(' ') + '\n';
  };
  let cfg;
  try {
    cfg = loadConfig();
  } finally {
    console.error = orig;
    clearFastPathEnv();
  }
  assert.equal(cfg.instances[0].readOnly, true); // fail safe, not writable
  assert.match(captured, /not recognized/i);
});

test('fast path: URL set but password missing throws naming the field', () => {
  clearFastPathEnv();
  process.env.SERVICENOW_URL = 'https://dev123456.service-now.com';
  process.env.SERVICENOW_USERNAME = 'api.user';
  // no password
  try {
    assert.throws(() => loadConfig(), /SERVICENOW_PASSWORD/);
  } finally {
    clearFastPathEnv();
  }
});

test('fast path: blank (whitespace) values are treated as unset', () => {
  clearFastPathEnv();
  process.env.SERVICENOW_URL = '   '; // plugin substitutes empty when blank
  try {
    // URL blank -> fast path doesn't apply; falls through to no-config error.
    assert.throws(() => loadConfig(), /No ServiceNow configuration found/);
  } finally {
    clearFastPathEnv();
  }
});

test('precedence: SERVICENOW_CONFIG_PATH wins over fast-path env vars', () => {
  clearFastPathEnv();
  const dir = mkdtempSync(join(tmpdir(), 'now-mcp-cfg-'));
  const file = join(dir, 'instances.yaml');
  writeFileSync(
    file,
    'instances:\n' +
      '  - name: fromfile\n' +
      '    url: https://fromfile.service-now.com\n' +
      '    auth: { type: basic, username: admin, password: x }\n' +
      '    default: true\n',
  );
  process.env.SERVICENOW_CONFIG_PATH = file;
  process.env.SERVICENOW_URL = 'https://dev123456.service-now.com';
  process.env.SERVICENOW_USERNAME = 'api.user';
  process.env.SERVICENOW_PASSWORD = 'secret';
  try {
    const cfg = loadConfig();
    assert.equal(cfg.instances.length, 1);
    assert.equal(cfg.instances[0].name, 'fromfile'); // file, not env
  } finally {
    clearFastPathEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('precedence: warns when both a config file and fast-path fields are set', () => {
  clearFastPathEnv();
  const dir = mkdtempSync(join(tmpdir(), 'now-mcp-cfg-'));
  const file = join(dir, 'instances.yaml');
  writeFileSync(
    file,
    'instances:\n' +
      '  - name: fromfile\n' +
      '    url: https://fromfile.service-now.com\n' +
      '    auth: { type: basic, username: admin, password: x }\n' +
      '    default: true\n',
  );
  process.env.SERVICENOW_CONFIG_PATH = file;
  process.env.SERVICENOW_URL = 'https://dev123456.service-now.com';
  process.env.SERVICENOW_USERNAME = 'api.user';
  process.env.SERVICENOW_PASSWORD = 'secret';

  // logger.warn writes to console.error (stderr) — capture it.
  const orig = console.error;
  let captured = '';
  console.error = (...a) => {
    captured += a.join(' ') + '\n';
  };
  try {
    loadConfig();
  } finally {
    console.error = orig;
    clearFastPathEnv();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.match(captured, /both set/i);
  assert.match(captured, /ignored/i);
});

test('no config anywhere: error lists cwd and every checked source', () => {
  clearFastPathEnv();
  try {
    assert.throws(
      () => loadConfig(),
      (err) => {
        assert.match(err.message, /No ServiceNow configuration found/);
        assert.match(err.message, /Working directory:/);
        assert.match(err.message, /SERVICENOW_CONFIG_PATH: not set/);
        assert.match(err.message, /SERVICENOW_URL: not set/);
        assert.match(err.message, /SERVICENOW_PASSWORD: not set/);
        return true;
      },
    );
  } finally {
    clearFastPathEnv();
  }
});
