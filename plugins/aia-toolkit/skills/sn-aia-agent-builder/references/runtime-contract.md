# Runtime Contract — deep dive (Rhino sandbox rationale)

The canonical IIFE template plus the diagnostic rationale behind the hard rules.
For the enforced-rule summary in context, see [../SKILL.md](../SKILL.md)
(## Runtime Contract for Tool & Agent Scripts).

## Required IIFE shape

```js
// src/server/agents/<agent>/tool-scripts/<tool-name>.js
(function (inputs) {
    function getConnection(connectionSysId) {            // helpers INLINE — no require
        var gr = new GlideRecordSecure('http_connection'); // platform global — no import
        if (!gr.get(connectionSysId) || !gr.canRead()) return null;
        return { endpoint: gr.getValue('connection_url'), credential: gr.getValue('credential') };
    }
    var conn = getConnection(inputs.connectionSysId);
    if (!conn) return { status: 'error', message: 'Connection not found or not readable' };
    // ... tool logic ...
    return { status: 'success', data: /* ... */ };          // return on EVERY path
})(inputs); // ← IIFE invoked: this expression's value IS the tool output
```

The rules this shape satisfies (IIFE final expression; no `import`/`export`/
`require`; inline every helper; return on every path; `Now.include()` the source
`.js`, never `dist/`) are enforced by `scripts/anti-pattern-scan.sh`. The `why`
follows.

## Why scripts must be plain `.js` (the four ways a `tsc`/CommonJS build fails at runtime)

Tool/agent scripts must be authored as plain `.js`, not `.ts`, and `Now.include()` must point at the source `.js` file directly — never a `dist/` compile output. A `tsc` step that targets `module: "commonjs"` produces `exports.foo = ...` / `require(...)`, which fails in four cascading ways:

1. `Object.defineProperty(exports, ...)` → `RhinoEcmaError: "exports" is not defined` (script dies on line 2).
2. Even past that, `export function foo(){}` only *defines* a function — nothing calls it. The tool returns `undefined` while the framework reports `status: "success"`. This **silent phantom success** is the worst failure: it looks like it worked but emits empty/placeholder data.
3. `require('./utils.js')` cannot resolve — there is no filesystem on the instance; the script field is a lone string. → `undefined is not a function`.
4. `import { GlideRecordSecure } from '@servicenow/glide'` compiles to `require('@servicenow/glide')`, which also fails — even though `GlideRecordSecure` is already a Rhino global you can use directly.

## Why not a bundler

> **Why not keep TypeScript via a bundler (esbuild `--format=iife`)?** It works in principle, but the deployed `script` field then holds bundled/transpiled output. Debugging is by Rhino stack trace (`sn_aia_tool.<id>.script : Line(N)`), so **source == deployed** is a real advantage — the line numbers in the log map to the code you wrote. Plain JS also matches OOB convention and needs zero build tooling. Only reach for a bundler if an agent has substantial logic shared across many tools AND the team wants type-checking; otherwise author plain JS.
