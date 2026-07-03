import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOAuthToken,
  clearAllOAuthTokens,
  createOAuthHeader,
} from '../build/client/auth.js';

// --- fetch mock -----------------------------------------------------------
// Each test installs a fake global fetch that records the calls it receives
// and returns queued responses, so we can assert on the exact token-endpoint
// request body without hitting the network.
let calls;
let responses;

function okJson(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errText(status, statusText, text) {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({}),
    text: async () => text,
  };
}

/** Parse the URLSearchParams body of the Nth recorded call into an object. */
function bodyParams(i) {
  return Object.fromEntries(new URLSearchParams(calls[i].init.body));
}

beforeEach(() => {
  calls = [];
  responses = [];
  clearAllOAuthTokens();
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no mock response queued');
    return next;
  };
});

afterEach(() => {
  clearAllOAuthTokens();
  delete globalThis.fetch;
});

const BASE = {
  clientId: 'cid',
  clientSecret: 'secret',
  tokenUrl: 'https://x.service-now.com/oauth_token.do',
};

// --- client_credentials (default) ----------------------------------------

test('client_credentials: sends the right grant and returns the token', async () => {
  responses.push(okJson({ access_token: 'tok-cc', expires_in: 3600 }));

  const token = await getOAuthToken({ ...BASE });

  assert.equal(token, 'tok-cc');
  assert.equal(calls.length, 1);
  const p = bodyParams(0);
  assert.equal(p.grant_type, 'client_credentials');
  assert.equal(p.client_id, 'cid');
  assert.equal(p.client_secret, 'secret');
  // no user creds leak into the app-level grant
  assert.equal(p.username, undefined);
  assert.equal(p.password, undefined);
});

test('grantType omitted defaults to client_credentials', async () => {
  responses.push(okJson({ access_token: 'tok', expires_in: 3600 }));
  await getOAuthToken({ ...BASE });
  assert.equal(bodyParams(0).grant_type, 'client_credentials');
});

test('caches the token: a second call does not hit the endpoint again', async () => {
  responses.push(okJson({ access_token: 'tok-1', expires_in: 3600 }));

  const first = await getOAuthToken({ ...BASE });
  const second = await getOAuthToken({ ...BASE });

  assert.equal(first, 'tok-1');
  assert.equal(second, 'tok-1');
  assert.equal(calls.length, 1); // only the first triggered a request
});

// --- password grant -------------------------------------------------------

test('password grant: sends username/password and returns the token', async () => {
  responses.push(okJson({ access_token: 'tok-pw', expires_in: 3600 }));

  const token = await getOAuthToken({
    ...BASE,
    grantType: 'password',
    username: 'api.user',
    password: 'pw',
    scope: 'useraccount',
  });

  assert.equal(token, 'tok-pw');
  const p = bodyParams(0);
  assert.equal(p.grant_type, 'password');
  assert.equal(p.username, 'api.user');
  assert.equal(p.password, 'pw');
  assert.equal(p.scope, 'useraccount');
});

test('password grant requires username and password', async () => {
  await assert.rejects(
    () => getOAuthToken({ ...BASE, grantType: 'password', username: 'u' }),
    /requires both username and password/,
  );
  await assert.rejects(
    () => getOAuthToken({ ...BASE, grantType: 'password', password: 'p' }),
    /requires both username and password/,
  );
  assert.equal(calls.length, 0); // never reaches the network
});

test('password grant renews via refresh_token (no password re-send)', async () => {
  // First exchange returns a token that is already expired (negative expires_in
  // after the 5-min buffer), plus a refresh_token.
  responses.push(
    okJson({ access_token: 'tok-old', expires_in: 1, refresh_token: 'refresh-1' }),
  );
  responses.push(okJson({ access_token: 'tok-new', expires_in: 3600 }));

  const cfg = { ...BASE, grantType: 'password', username: 'u', password: 'p' };

  const first = await getOAuthToken(cfg);
  const second = await getOAuthToken(cfg);

  assert.equal(first, 'tok-old');
  assert.equal(second, 'tok-new');
  assert.equal(calls.length, 2);

  // Second call must use the refresh_token grant, NOT re-send the password.
  const p = bodyParams(1);
  assert.equal(p.grant_type, 'refresh_token');
  assert.equal(p.refresh_token, 'refresh-1');
  assert.equal(p.password, undefined);
});

test('password grant falls back to password exchange when refresh fails', async () => {
  responses.push(
    okJson({ access_token: 'tok-old', expires_in: 1, refresh_token: 'refresh-1' }),
  );
  responses.push(errText(401, 'Unauthorized', 'invalid_grant')); // refresh fails
  responses.push(okJson({ access_token: 'tok-fresh', expires_in: 3600 }));

  const cfg = { ...BASE, grantType: 'password', username: 'u', password: 'p' };

  await getOAuthToken(cfg);
  const token = await getOAuthToken(cfg);

  assert.equal(token, 'tok-fresh');
  assert.equal(calls.length, 3);
  // Last call is the fresh password exchange.
  const p = bodyParams(2);
  assert.equal(p.grant_type, 'password');
  assert.equal(p.username, 'u');
  assert.equal(p.password, 'p');
});

test('client_credentials and password tokens are cached separately', async () => {
  responses.push(okJson({ access_token: 'tok-cc', expires_in: 3600 }));
  responses.push(okJson({ access_token: 'tok-pw', expires_in: 3600 }));

  const cc = await getOAuthToken({ ...BASE });
  const pw = await getOAuthToken({
    ...BASE,
    grantType: 'password',
    username: 'u',
    password: 'p',
  });

  assert.equal(cc, 'tok-cc');
  assert.equal(pw, 'tok-pw');
  assert.equal(calls.length, 2); // distinct cache keys → two requests
});

// --- error handling -------------------------------------------------------

test('surfaces a failed token request', async () => {
  responses.push(errText(400, 'Bad Request', 'invalid_client'));
  await assert.rejects(
    () => getOAuthToken({ ...BASE }),
    /OAuth token request failed: 400.*invalid_client/s,
  );
});

test('rejects a response missing access_token', async () => {
  responses.push(okJson({ token_type: 'Bearer', expires_in: 3600 }));
  await assert.rejects(() => getOAuthToken({ ...BASE }), /missing access_token/);
});

test('createOAuthHeader formats a Bearer header', () => {
  assert.equal(createOAuthHeader('abc'), 'Bearer abc');
});
