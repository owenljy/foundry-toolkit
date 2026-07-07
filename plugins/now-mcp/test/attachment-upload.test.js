import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceNowClient } from '../build/client/servicenow-client.js';

// --- fetch mock -----------------------------------------------------------
// Mirrors the pattern in oauth.test.js: install a fake global fetch that
// records the calls it receives and returns a queued response, so we can
// assert on the exact request the client sends without hitting the network.
let calls;
let responses;

function okJson(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { forEach: () => {} },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no mock response queued');
    return next;
  };
});

afterEach(() => {
  delete globalThis.fetch;
});

test('uploadFile POSTs multipart form data to the /attachment/upload endpoint', async () => {
  responses.push(okJson({ result: { sys_id: 'a'.repeat(32) } }));

  const client = new ServiceNowClient('https://dev123.service-now.com', {
    type: 'basic',
    username: 'admin',
    password: 'pw',
  });

  await client.uploadFile(Buffer.from('hello'), 'hello.txt', 'incident', 'b'.repeat(32));

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];

  // Must hit the multipart upload endpoint, not the raw-binary /attachment/file one.
  assert.ok(
    url.endsWith('/api/now/attachment/upload'),
    `expected URL to end with /api/now/attachment/upload, got ${url}`,
  );
  assert.ok(!url.includes('/api/now/attachment/file'));

  const body = init.body;
  assert.ok(body instanceof FormData, 'expected a FormData body');

  assert.equal(body.get('table_name'), 'incident');
  assert.equal(body.get('table_sys_id'), 'b'.repeat(32));

  const filePart = body.get('uploadFile');
  assert.ok(filePart, 'expected a file part under the "uploadFile" key');
  assert.equal(filePart.name, 'hello.txt');

  // The old (broken) field names must not be present.
  assert.equal(body.get('file_name'), null);
  assert.equal(body.get('file'), null);
});
