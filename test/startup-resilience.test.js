import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { registerDegradedTools } from '../build/tools/index.js';

// --- Unit: degraded handlers return the config error, never throw ---------

test('registerDegradedTools registers a single status tool that reports the error on call', async () => {
  const registered = [];
  // Degraded mode now stays on the high-level McpServer API: it registers one
  // status tool via `registerTool` (handshake + schema advertisement + error
  // path all on the supported API), so the fake mirrors that shape.
  const fakeServer = {
    registerTool: (name, config, handler) => {
      registered.push({ name, config, handler });
    },
  };

  await registerDegradedTools(fakeServer, new Error('No ServiceNow configuration found.'));
  assert.equal(registered.length, 1);

  const [{ name, config, handler }] = registered;
  assert.equal(name, 'servicenow_status');
  assert.equal(config.annotations.readOnlyHint, true);
  assert.equal(config.annotations.destructiveHint, false);

  const call = await handler({});
  assert.equal(call.isError, true);
  assert.match(call.content[0].text, /configuration error/i);
  assert.match(call.content[0].text, /No ServiceNow configuration found/);
});

// --- Integration: the process stays up (degraded) on invalid config -------

test('server does not exit on invalid config — it degrades and keeps the connection', async () => {
  const child = spawn('node', ['build/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // Point at a missing YAML so loadConfig throws -> server degrades (stays up).
      SERVICENOW_CONFIG_PATH: '/nonexistent/definitely-not-here.yaml',
      // Follow is on by default now; disable explicitly so a locally-installed
      // now-sdk can't spawn during this startup test.
      SERVICENOW_FOLLOW_NOW_SDK: 'false',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  let exitedEarly = false;
  let earlyCode = null;
  child.on('exit', (code) => {
    exitedEarly = true;
    earlyCode = code;
  });

  await new Promise((r) => setTimeout(r, 1500));
  const aliveAfterStartup = !exitedEarly;
  child.kill('SIGKILL');

  assert.ok(
    aliveAfterStartup,
    `server should stay up in degraded mode, but it exited (code ${earlyCode}). stderr: ${stderr.slice(0, 500)}`
  );
  assert.match(stderr, /DEGRADED/i, `expected a degraded-mode log; stderr: ${stderr.slice(0, 500)}`);
});
