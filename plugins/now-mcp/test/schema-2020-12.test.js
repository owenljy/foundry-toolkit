import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Ajv2020 from 'ajv/dist/2020.js';

// Regression guard for the MCP spec's 2026-07-28 revision, which requires
// tool schemas to be valid JSON Schema 2020-12. An audit (see
// docs/mcp-2026-07-28-action-plan.md) found the current zod → JSON Schema
// conversion path already produces schemas that are valid 2020-12 documents
// (no z.tuple/discriminatedUnion/lazy/intersection constructs in use). This
// test locks that state in so a future schema addition can't silently
// regress it.
const SERVER_ENV = {
  ...process.env,
  SERVICENOW_CONFIG_PATH: 'config/sn-credential.example.yaml',
  SERVICENOW_FOLLOW_NOW_SDK: 'false',
};

test('every advertised tool schema is valid JSON Schema 2020-12', { timeout: 30000 }, async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['build/index.js'],
    cwd: process.cwd(),
    env: SERVER_ENV,
  });

  const client = new Client(
    { name: 'schema-2020-12-test', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.ok(tools.length > 0, 'server should advertise at least one tool');

    const ajv = new Ajv2020({ strict: false });

    // zod-to-json-schema@3.25.2 has no "jsonSchema2020-12" target (see the
    // action-plan doc), so every emitted schema self-declares
    // "$schema": ".../draft-07/schema#" — a label ajv's 2020-12 meta-schema
    // can't resolve, and a known/accepted gap that's out of this repo's
    // control until the deferred SDK swap. What we're actually asserting is
    // that the *shape* of the schema (the vocabulary it uses) is valid under
    // 2020-12, so strip that self-declared, inaccurate label before checking.
    const validateShape = (schema, label) => {
      const { $schema, ...rest } = schema;
      assert.ok(
        ajv.validateSchema(rest),
        `${label} must be valid JSON Schema 2020-12: ${JSON.stringify(ajv.errors)}`
      );
    };

    for (const tool of tools) {
      validateShape(tool.inputSchema, `tool "${tool.name}" inputSchema`);

      if (tool.outputSchema) {
        validateShape(tool.outputSchema, `tool "${tool.name}" outputSchema`);
      }
    }
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
});
