#!/usr/bin/env node
/**
 * fluent — CLAUDE.md bootstrapper (idempotent, fast).
 *
 * Purpose: when Claude Code opens a Fluent project (marker: `now.config.json`
 * at project root), guarantee the project's CLAUDE.md contains the
 * "always run `now-sdk explain` before writing Fluent code" rule. This is a
 * standing instruction — CLAUDE.md is injected into every session's system
 * prompt, so it is far more reliable than trying to trigger a skill.
 *
 * Wired in `hooks/hooks.json` as a SessionStart hook. That means it runs on
 * EVERY session start, so it MUST be fast and MUST be a no-op when the rule is
 * already present. It is idempotent by design: a fenced anchor block
 * (BEGIN/END markers) is looked for; if present, exit without touching disk.
 *
 * Detection uses process.cwd() — SessionStart hooks run with cwd = the user's
 * working directory (the project they just opened), which is what we want.
 *
 * Output goes to stderr only; stdout is reserved for MCP protocol traffic
 * elsewhere in this plugin and this hook shares the same shell.
 */

import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Anchor markers make the injected block re-findable across future runs. If
// the user hand-edits the block between them, we detect its presence and skip
// — we never overwrite their edits.
const BEGIN = '<!-- BEGIN fluent-plugin: workflow -->';
const END = '<!-- END fluent-plugin: workflow -->';

const BODY = `## Fluent workflow (injected by the \`fluent\` Claude Code plugin)

Before writing ANY Fluent (\`*.now.ts\`) code, ALWAYS run \`now-sdk explain <API>\`
to get the authoritative signature. Never guess API names, parameter shapes, or
type imports from memory.

- Unsure of an API name → \`now-sdk explain <partial-name>\`
- Unsure of a class's methods → \`now-sdk explain <ClassName>\`
- Unsure of a field type or option → \`now-sdk explain <ClassName>.<method>\`

Rule of thumb: if you are about to type a Fluent API you have not \`explain\`ed
in the last few messages, \`explain\` it first. This trades ~1 tool call for a
correct-first-time deploy.

To customize this block: edit between the BEGIN/END markers below. To remove
it: delete the whole block (markers included) — the hook will not re-add it if
the markers are gone AND you've replaced them with your own \`## Fluent
workflow\` heading. To silence the hook entirely: set the env var
\`FLUENT_BOOTSTRAP_CLAUDEMD=off\`.
`;

const BLOCK = `${BEGIN}\n${BODY}${END}\n`;

function log(msg) {
  process.stderr.write(`[fluent bootstrap] ${msg}\n`);
}

function main() {
  if ((process.env.FLUENT_BOOTSTRAP_CLAUDEMD || '').toLowerCase() === 'off') {
    return 0;
  }

  const cwd = process.cwd();
  const marker = join(cwd, 'now.config.json');
  if (!existsSync(marker)) {
    // Not a Fluent project — nothing to do. Silent no-op (this hook runs on
    // every SessionStart, so noise here would be noise everywhere).
    return 0;
  }

  const claudeMd = join(cwd, 'CLAUDE.md');
  const existing = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : null;

  if (existing !== null) {
    // Already bootstrapped by this hook — done.
    if (existing.includes(BEGIN)) return 0;
    // User authored their own Fluent workflow section — respect it, do not stomp.
    if (/^##\s+Fluent workflow\b/mi.test(existing)) return 0;
  }

  try {
    if (existing === null) {
      writeFileSync(claudeMd, BLOCK);
      log('created CLAUDE.md with Fluent workflow rules.');
    } else {
      const sep = existing.endsWith('\n') ? '\n' : '\n\n';
      appendFileSync(claudeMd, sep + BLOCK);
      log('appended Fluent workflow rules to CLAUDE.md.');
    }
  } catch (e) {
    // Never fail the session over a bootstrap write; log and move on.
    log(`WARN: could not write CLAUDE.md: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
  return 0;
}

process.exit(main());
