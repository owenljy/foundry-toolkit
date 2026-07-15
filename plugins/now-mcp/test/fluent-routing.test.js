import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const bootstrap = join(root, 'scripts', 'bootstrap-fluent-claudemd.mjs');
const skill = readFileSync(join(root, 'skills', 'sn-docs-search', 'SKILL.md'), 'utf8');
const template = readFileSync(join(root, 'scripts', 'claude-md-template.md'), 'utf8');

function fluentProject(claudeMd) {
  const cwd = mkdtempSync(join(tmpdir(), 'now-mcp-fluent-'));
  writeFileSync(join(cwd, 'now.config.json'), '{}');
  if (claudeMd !== undefined) writeFileSync(join(cwd, 'CLAUDE.md'), claudeMd);
  return cwd;
}

function runBootstrap(cwd) {
  const result = spawnSync(process.execPath, [bootstrap], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('routing explicitly gives now-sdk explain precedence for Fluent APIs', () => {
  assert.match(skill, /Do NOT use for Fluent SDK authoring/);
  assert.match(skill, /now-sdk explain <topic> --format=raw/);
  assert.match(template, /Routing precedence:[\s\S]*now-sdk explain[\s\S]*wins over `sn-docs-search`/);
});

test('bootstrap creates a versioned workflow block and is idempotent', () => {
  const cwd = fluentProject();
  runBootstrap(cwd);
  const first = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
  assert.match(first, /BEGIN fluent-plugin: workflow v2/);
  assert.match(first, /now-sdk explain/);
  runBootstrap(cwd);
  assert.equal(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8'), first);
});

test('bootstrap upgrades a legacy managed block without changing surrounding content', () => {
  const legacy = 'Project notes\n\n<!-- BEGIN fluent-plugin: workflow -->\nold rules\n<!-- END fluent-plugin: workflow -->\n\nTail\n';
  const cwd = fluentProject(legacy);
  runBootstrap(cwd);
  const updated = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
  assert.match(updated, /^Project notes/);
  assert.match(updated, /BEGIN fluent-plugin: workflow v2/);
  assert.doesNotMatch(updated, /old rules/);
  assert.match(updated, /Tail\n$/);
});

test('bootstrap respects an unmarked user-authored Fluent workflow', () => {
  const authored = '# App\n\n## Fluent workflow\nMy custom rules.\n';
  const cwd = fluentProject(authored);
  runBootstrap(cwd);
  assert.equal(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8'), authored);
});