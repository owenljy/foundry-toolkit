import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAuthList,
  normalizeHost,
  computeAlignment,
  findInstanceByHost,
  parseSemVer,
  compareSemVer,
  satisfiesAtLeast,
  resolveFeatures,
  isAuthListFormatVerified,
  NOW_SDK_FEATURE_CONSTRAINTS,
} from '../build/utils/now-sdk-cli.js';

// VERIFIED real 4.8.0 `now-sdk auth --list -o json` output: the `-o json` flag
// is ignored and only human text is printed — a preamble (note the trailing
// space the CLI actually emits), a `*[alias]` default marker, then indented
// host/type/username/default kv lines. This is the exact shape parseAuthList
// must keep handling (D5: no JSON in 4.8.0).
const SAMPLE = `[now-sdk] Listing all credentials:
[152992]
      host = https://demoalectriallwfaa152992.service-now.com
      type = basic
      username = admin
      default = No
*[dsta]
      host = https://demoalectriallwfzj147775.service-now.com/
      type = basic
      username = owen.liang
      default = Yes`;

test('parseAuthList extracts alias/host/type/username/isDefault from real 4.8.0 text (incl. default *)', () => {
  const profiles = parseAuthList(SAMPLE);
  assert.equal(profiles.length, 2);

  // Non-default profile: every field parsed, isDefault false.
  const nondefault = profiles.find((p) => p.alias === '152992');
  assert.ok(nondefault, 'parsed the [152992] credential');
  assert.equal(nondefault.host, 'https://demoalectriallwfaa152992.service-now.com');
  assert.equal(nondefault.type, 'basic');
  assert.equal(nondefault.username, 'admin');
  assert.equal(nondefault.isDefault, false);

  // Default profile: marked both by the leading '*' AND `default = Yes`.
  const def = profiles.find((p) => p.alias === 'dsta');
  assert.ok(def, 'parsed the *[dsta] credential');
  assert.equal(def.host, 'https://demoalectriallwfzj147775.service-now.com/');
  assert.equal(def.type, 'basic');
  assert.equal(def.username, 'owen.liang');
  assert.equal(def.isDefault, true);

  // Exactly one default across the list.
  assert.equal(profiles.filter((p) => p.isDefault).length, 1);
});

test('parseAuthList skips the preamble and tolerates missing username/oauth profiles', () => {
  const sample = `[now-sdk] Listing all credentials:
[oauth-only]
      host = https://dev234567.service-now.com
      type = oauth
      default = No
*[basic-def]
      host = https://dev200002.service-now.com/
      type = basic
      username = demo.user
      default = Yes`;
  const profiles = parseAuthList(sample);
  assert.equal(profiles.length, 2);
  const oauth = profiles.find((p) => p.alias === 'oauth-only');
  assert.equal(oauth.type, 'oauth');
  assert.equal(oauth.username, undefined);
  assert.equal(oauth.isDefault, false);
  assert.equal(profiles.find((p) => p.alias === 'basic-def').isDefault, true);
});

test("parseAuthList sets isDefault from a '*' marker even without a default = Yes line", () => {
  const sample = `*[only]
      host = https://dev1.service-now.com
      type = basic`;
  const [p] = parseAuthList(sample);
  assert.equal(p.isDefault, true);
});

test('normalizeHost ignores protocol, trailing slash, and case', () => {
  assert.equal(normalizeHost('https://Demo.service-now.com/'), 'demo.service-now.com');
  assert.equal(normalizeHost('http://demo.service-now.com'), 'demo.service-now.com');
});

test('computeAlignment matches MCP instances to now-sdk profiles by host', () => {
  const profiles = parseAuthList(SAMPLE);
  const configured = [
    // matches the [152992] profile (host w/o trailing slash vs profile w/o slash)
    { name: 'aus', url: 'https://demoalectriallwfaa152992.service-now.com' },
    { name: 'other', url: 'https://unknown999.service-now.com' }, // no profile
  ];
  const alignment = computeAlignment(configured, profiles);

  const aus = alignment.find((a) => a.instance === 'aus');
  assert.equal(aus.aligned, true);
  assert.equal(aus.matchedProfile, '152992');

  const other = alignment.find((a) => a.instance === 'other');
  assert.equal(other.aligned, false);
  assert.equal(other.matchedProfile, null);
});

test('findInstanceByHost matches a YAML instance to a now-sdk host (ignoring protocol/trailing slash)', () => {
  const instances = [
    { name: 'inst-a', url: 'https://dev100001.service-now.com/' },
    { name: 'dsta-demo', url: 'https://dev200002.service-now.com/' },
  ];
  assert.equal(findInstanceByHost(instances, 'https://dev100001.service-now.com'), 'inst-a');
  assert.equal(findInstanceByHost(instances, 'dev200002.service-now.com/'), 'dsta-demo');
  assert.equal(findInstanceByHost(instances, 'https://nope.service-now.com'), null);
});

test('parseSemVer parses real 4.8.0 --version output and tolerates v-prefix / metadata', () => {
  assert.deepEqual(parseSemVer('4.8.0'), { major: 4, minor: 8, patch: 0 });
  assert.deepEqual(parseSemVer('v4.7.2'), { major: 4, minor: 7, patch: 2 });
  assert.deepEqual(parseSemVer('4.8'), { major: 4, minor: 8, patch: 0 });
  assert.deepEqual(parseSemVer('now-sdk 4.9.1-beta.3'), { major: 4, minor: 9, patch: 1 });
  assert.equal(parseSemVer(null), null);
  assert.equal(parseSemVer('not-a-version'), null);
});

test('compareSemVer orders by major, then minor, then patch', () => {
  const v = (s) => parseSemVer(s);
  assert.ok(compareSemVer(v('4.8.0'), v('4.7.9')) > 0);
  assert.ok(compareSemVer(v('4.8.0'), v('5.0.0')) < 0);
  assert.equal(compareSemVer(v('4.8.0'), v('4.8.0')), 0);
});

test('satisfiesAtLeast honors >= constraints and treats unknown version as false', () => {
  assert.equal(satisfiesAtLeast(parseSemVer('4.8.0'), '>=4.8.0'), true);
  assert.equal(satisfiesAtLeast(parseSemVer('4.8.0'), '>=4.7.0'), true);
  assert.equal(satisfiesAtLeast(parseSemVer('4.6.0'), '>=4.8.0'), false);
  assert.equal(satisfiesAtLeast(null, '>=4.8.0'), false);
});

test('resolveFeatures resolves the constraint map to booleans for the detected version', () => {
  const at48 = resolveFeatures(parseSemVer('4.8.0'));
  assert.equal(at48.query, true); // >=4.8.0
  assert.equal(at48.transformById, true); // >=4.7.0

  const at47 = resolveFeatures(parseSemVer('4.7.0'));
  assert.equal(at47.query, false); // 4.7.0 < 4.8.0
  assert.equal(at47.transformById, true);

  // Unknown version: assume nothing — every feature false.
  const unknown = resolveFeatures(null);
  for (const key of Object.keys(NOW_SDK_FEATURE_CONSTRAINTS)) {
    assert.equal(unknown[key], false);
  }
});

test('isAuthListFormatVerified trusts the verified major (4.x) and flags others/unknown', () => {
  assert.equal(isAuthListFormatVerified(parseSemVer('4.8.0')), true);
  assert.equal(isAuthListFormatVerified(parseSemVer('4.7.0')), true);
  assert.equal(isAuthListFormatVerified(parseSemVer('5.0.0')), false); // newer major: format may drift
  assert.equal(isAuthListFormatVerified(null), false); // unknown: unverified
});
