# Credential field & special auth reference

Vendor-specific snippets to **inline inside a tool's IIFE** when authoring a script tool that calls a specific 3rd-party API (Step 4). These are platform globals — do NOT `import` them.

Back to process: [../SKILL.md](../SKILL.md)

#### Credential field reference

| Vendor | `getAttribute(...)` | Header name(s) | Header value format |
|---|---|---|---|
| Datadog | `'api_key'`, `'authentication_key'` | `DD-API-KEY`, `DD-APPLICATION-KEY` | raw key values (two separate headers required) |
| Dynatrace (classic) | `'api_key'` | `Authorization` | `'Api-Token ' + apiKey` |
| Dynatrace (Grail) | `'authentication_key'` | `Authorization` | `'Bearer ' + grailApiKey` |
| Splunk Observability | `'api_key'` | `X-SF-Token` | raw key value |
| Splunk Enterprise | `'api_key'` | `Authorization` | `'Bearer ' + apiKey` |
| New Relic | `'api_key'`, `'user_name'` (account ID as integer) | `API-Key` | raw key value |
| LogicMonitor | `'api_key'` | `Authorization` | `'Bearer ' + apiKey` |
| Cisco ThousandEyes | `'api_key'` | `Authorization` | `'Bearer ' + apiKey` |
| Prometheus | `'user_name'`, `'password'` | `Authorization` | `'Basic ' + gs.base64Encode(user + ':' + pass)` |
| SolarWinds | `'user_name'`, `'password'` | `Authorization` | `'Basic ' + gs.base64Encode(user + ':' + pass)` |
| Azure Monitor | `'user_name'` (subscription ID) | (OAuth — see note) | managed by ServiceNow HTTP connection record |
| AWS | (none — see note) | `Authorization` + `X-Amz-Date` etc. | SigV4 signing via `RequestAuthAPI` |

#### Special auth notes

> All snippets below are plain JS to inline inside the tool's IIFE — `gs`, `RESTMessageV2`, `StandardCredentialsProvider`, `HttpRequestData`, `RequestAuthAPI` are platform globals. Do NOT `import` them.

**Basic Auth (Prometheus, SolarWinds):**
```js
var auth = 'Basic ' + gs.base64Encode(username + ':' + password);
request.setRequestHeader('Authorization', auth);
```

**Azure Monitor — OAuth via HTTP connection:** Uses OAuth tokens managed by the ServiceNow HTTP connection record. Do not extract credentials manually:
```js
var request = new RESTMessageV2('global.' + connectionName, 'Default GET');
// ServiceNow handles token refresh automatically.
```

**AWS — SigV4 signing:**

> CRITICAL: use `getAuthCredentialByID()`, NOT `getCredentialByID()` — they return different types. `getCredentialByID()` returns `ScriptableStandardCredential`; `RequestAuthAPI` requires `ScriptableRequestAuthCredential`. Passing the wrong type throws a `ClassCastException` at runtime.

```js
var credProvider = new StandardCredentialsProvider();
var credential   = credProvider.getAuthCredentialByID(credentialId); // <-- getAuthCredentialByID

var host   = endpoint.replace(/^https?:\/\//, '');
var region = host.split('.')[1];

var httpRequestData = new HttpRequestData();
httpRequestData.setHttpMethod('POST');
httpRequestData.setEndpoint(endpoint);
httpRequestData.setService('<aws-service>');
httpRequestData.setRegion(region);
httpRequestData.setContent(JSON.stringify(requestBody));

var headerMap = new RequestAuthAPI(httpRequestData, credential).generateAuth().getHeaderMap();
for (var key in headerMap) { request.setRequestHeader(key, headerMap[key]); }
```

> StartTime/EndTime must be Unix epoch seconds (integers), NOT ISO strings — passing ISO strings causes a `SerializationException` (400). Convert with: `Math.floor(new Date(isoString).getTime() / 1000)`
