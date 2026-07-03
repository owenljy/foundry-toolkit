import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { MultiInstanceConfigSchema } from '../build/config/environment.js';
import { loadConfig as loadCliConfig, saveConfig } from '../build/config/config-file.js';

test('the shipped example YAML parses and passes schema validation', () => {
  const content = readFileSync('config/servicenow-instances.example.yaml', 'utf-8');
  const parsed = yaml.load(content);
  const result = MultiInstanceConfigSchema.safeParse(parsed);
  assert.ok(result.success, JSON.stringify(result.error?.errors));
  // The example leads with a single active instance (the second is commented
  // out as an optional add-on), with exactly one default.
  assert.equal(result.data.instances.length, 1);
  assert.equal(result.data.instances.filter((i) => i.default).length, 1);
});

test('numeric instance names (unquoted in YAML) are coerced to strings', () => {
  // ServiceNow PDI names are often pure numbers; YAML types them as numbers.
  const parsed = yaml.load(
    'instances:\n' +
      '  - name: 123456\n' +
      '    url: https://123456.service-now.com\n' +
      '    auth: { type: basic, username: admin, password: x }\n' +
      '    default: true\n'
  );
  const result = MultiInstanceConfigSchema.safeParse(parsed);
  assert.ok(result.success, JSON.stringify(result.error?.errors));
  assert.equal(result.data.instances[0].name, '123456');
  assert.equal(typeof result.data.instances[0].name, 'string');
});

test('oauth without grantType defaults to client_credentials (back-compat)', () => {
  const parsed = yaml.load(
    'instances:\n' +
      '  - name: prod\n' +
      '    url: https://prod.service-now.com\n' +
      '    auth: { type: oauth, clientId: c, clientSecret: s, tokenUrl: https://prod.service-now.com/oauth_token.do }\n' +
      '    default: true\n'
  );
  const result = MultiInstanceConfigSchema.safeParse(parsed);
  assert.ok(result.success, JSON.stringify(result.error?.errors));
  assert.equal(result.data.instances[0].auth.grantType, 'client_credentials');
});

test('oauth password grant requires username and password', () => {
  const parsed = yaml.load(
    'instances:\n' +
      '  - name: prod\n' +
      '    url: https://prod.service-now.com\n' +
      '    auth: { type: oauth, grantType: password, clientId: c, clientSecret: s, tokenUrl: https://prod.service-now.com/oauth_token.do }\n' +
      '    default: true\n'
  );
  const result = MultiInstanceConfigSchema.safeParse(parsed);
  assert.ok(!result.success, 'expected validation to fail without username/password');
  const paths = result.error.errors.map((e) => e.path.join('.'));
  assert.ok(paths.some((p) => p.endsWith('auth.username')));
  assert.ok(paths.some((p) => p.endsWith('auth.password')));
});

test('oauth password grant passes with username and password', () => {
  const parsed = yaml.load(
    'instances:\n' +
      '  - name: prod\n' +
      '    url: https://prod.service-now.com\n' +
      '    auth: { type: oauth, grantType: password, clientId: c, clientSecret: s, tokenUrl: https://prod.service-now.com/oauth_token.do, username: u, password: p }\n' +
      '    default: true\n'
  );
  const result = MultiInstanceConfigSchema.safeParse(parsed);
  assert.ok(result.success, JSON.stringify(result.error?.errors));
  assert.equal(result.data.instances[0].auth.grantType, 'password');
  assert.equal(result.data.instances[0].auth.username, 'u');
});

test('YAML and equivalent JSON parse to the same object (superset)', () => {
  const jsonText = '{"instances":[{"name":"dev","url":"https://d.service-now.com","auth":{"type":"basic","username":"u","password":"p"},"default":true}]}';
  const yamlText = [
    'instances:',
    '  - name: dev',
    '    url: https://d.service-now.com',
    '    auth: { type: basic, username: u, password: p }',
    '    default: true',
  ].join('\n');
  assert.deepEqual(yaml.load(yamlText), JSON.parse(jsonText));
});

test('config-loader saves YAML and loads it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sn-yaml-'));
  const path = join(dir, 'config.yaml');
  try {
    const config = {
      instances: [
        { name: 'dev', url: 'https://dev.service-now.com', auth: { type: 'basic', username: 'u', password: 'p' }, default: true, readOnly: false },
        { name: 'prod', url: 'https://prod.service-now.com', auth: { type: 'basic', username: 'u', password: 'p' }, default: false },
      ],
    };
    saveConfig(config, path);

    // File is real YAML, not JSON (no surrounding braces)
    const raw = readFileSync(path, 'utf-8');
    assert.match(raw, /^instances:/m);
    assert.doesNotMatch(raw.trimStart(), /^\{/);

    const loaded = loadCliConfig(path);
    assert.equal(loaded.instances.length, 2);
    assert.equal(loaded.instances[0].name, 'dev');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
