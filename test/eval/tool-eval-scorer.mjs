/**
 * Tool-selection eval scorer (WS-B §4.3).
 *
 * A small, stable, reusable scorer for measuring how well a set of tool
 * descriptions lets an agent pick the right tool for a natural-language ask,
 * and whether it can recover the key parameters.
 *
 * Design goals (from the spec):
 * - DECOUPLED from any one description. The same algorithm runs over whatever
 *   {name, title, description} text each tool currently advertises, so the
 *   before/after delta reflects the descriptions, not the scorer.
 * - DETERMINISTIC. No LLM, no network — a token-overlap router stands in for the
 *   model's tool choice. Re-runnable in `node --test` and stable across runs.
 * - REUSABLE. This is the seed for the later self-improving track: feed it a new
 *   candidate-tool set + task set and it scores tool-selection + param-correctness.
 *
 * The router is an IDF-weighted bag-of-words match between the ask and each
 * candidate tool's advertised text. The tool whose text best "explains" the ask
 * wins. Trimming marketing filler raises the relative weight of the words that
 * actually discriminate one tool from another, so a good cleanup should hold or
 * improve the score, never tank it.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'is', 'are', 'be', 'as', 'at', 'from', 'that', 'this', 'it', 'its', 'use',
  'used', 'using', 'me', 'my', 'all', 'any', 'how', 'what', 'which', 'when',
  'show', 'list', 'get', 'give', 'i', 'we', 'you', 'do', 'does', 'into',
  'servicenow', 'record', 'records', 'table', 'tables', 'instance',
]);

/**
 * Light, deterministic stemmer: fold a few common English suffixes so
 * "incidents"/"incident", "querying"/"query", "definitions"/"define" match.
 * Not linguistically perfect — just enough to stop surface plural/tense
 * mismatches from dominating the routing signal. Underscored identifiers
 * (e.g. change_request, assignment_group) are left intact.
 */
function stem(tok) {
  if (tok.includes('_') || tok.length <= 3) return tok;
  for (const suf of ['ing', 'ions', 'ion', 'ies', 'es', 's', 'ed']) {
    if (tok.endsWith(suf) && tok.length - suf.length >= 3) {
      let base = tok.slice(0, -suf.length);
      if (suf === 'ies') base += 'y'; // queries → query
      return base;
    }
  }
  return tok;
}

/** Lowercase, split on non-alphanumerics, drop stopwords/1-char tokens, stem. */
export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Build an IDF map over the candidate corpus. A word that appears in every
 * tool's text carries no signal (idf→0); a word unique to one tool is highly
 * discriminative. Computed from the candidate set only, so it adapts to
 * whatever descriptions are passed in.
 *
 * @param {Array<{name:string,title?:string,description:string}>} candidates
 */
function buildIdf(candidates) {
  const docFreq = new Map();
  for (const c of candidates) {
    const seen = new Set(tokenize(`${c.name} ${c.title ?? ''} ${c.description}`));
    for (const tok of seen) docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
  }
  const n = candidates.length;
  const idf = new Map();
  for (const [tok, df] of docFreq) {
    // smoothed idf, floored at 0 so ubiquitous words contribute nothing
    idf.set(tok, Math.max(0, Math.log((n + 1) / (df + 0.5))));
  }
  return idf;
}

/**
 * Split a description into its structured "contract" header (the
 * What/When-to-use/Preconditions/Produces lines every v4 tool carries) and the
 * free-form body. The header is where the discriminating intent lives, so we
 * weight it higher than the body. This is what makes a tight, well-written
 * description competitive with a verbose one: signal in the header beats sheer
 * keyword surface area in the body.
 */
function splitHeaderBody(description) {
  const lines = String(description).split('\n');
  const headerLines = [];
  const bodyLines = [];
  const headerKey = /^(what|when to use|when|preconditions|produces|behavior)\s*:/i;
  let inHeader = false;
  for (const line of lines) {
    if (headerKey.test(line.trim())) {
      inHeader = true;
      headerLines.push(line);
    } else if (inHeader && line.trim() === '') {
      // a blank line ends the contract header block
      inHeader = false;
      bodyLines.push(line);
    } else if (inHeader) {
      headerLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }
  return { header: headerLines.join('\n'), body: bodyLines.join('\n') };
}

/**
 * Score one ask against one candidate: IDF-weighted overlap of ask-tokens with
 * the candidate's text. Matches are weighted by where they land — name/title
 * (strongest), the structured contract header, then the free-form body.
 */
function scoreCandidate(askTokens, candidate, idf) {
  const nameTokens = new Set(tokenize(`${candidate.name} ${candidate.title ?? ''}`));
  const { header, body } = splitHeaderBody(candidate.description);
  const headerTokens = new Set(tokenize(header));
  const bodyTokens = new Set(tokenize(body));
  let score = 0;
  for (const tok of askTokens) {
    const w = idf.get(tok) ?? 0;
    if (nameTokens.has(tok)) score += w * 3; // name/title match (strongest)
    else if (headerTokens.has(tok)) score += w * 2; // contract-header match
    else if (bodyTokens.has(tok)) score += w; // free-form body match
  }
  return score;
}

/**
 * Route an ask to the best-scoring candidate tool.
 * @returns {{tool:string|null, score:number, ranked:Array<{name:string,score:number}>}}
 */
export function routeAsk(ask, candidates, idf = buildIdf(candidates)) {
  const askTokens = tokenize(ask);
  const ranked = candidates
    .map((c) => ({ name: c.name, score: scoreCandidate(askTokens, c, idf) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  // A zero top-score means nothing matched — treat as "no choice".
  return { tool: top && top.score > 0 ? top.name : null, score: top?.score ?? 0, ranked };
}

/**
 * Extract the key params an agent would lift straight from the ask. Stable and
 * description-independent: a table name is recognised from the known-table set,
 * and a field name from a "<table> ... <field>" / quoted hint.
 *
 * @param {string} ask
 * @param {{knownTables?:string[], knownFields?:string[]}} [hints]
 */
export function extractParams(ask, hints = {}) {
  const lower = ask.toLowerCase();
  const params = {};

  const knownTables = hints.knownTables ?? [];
  for (const t of knownTables) {
    // tolerate a plural mention ("incidents" → incident table)
    if (new RegExp(`\\b${t}s?\\b`).test(lower)) {
      params.tableName = t;
      break;
    }
  }

  const knownFields = hints.knownFields ?? [];
  for (const f of knownFields) {
    if (new RegExp(`\\b${f}\\b`).test(lower)) {
      params.fieldName = f;
      break;
    }
  }

  return params;
}

/**
 * Score a whole task set against a candidate tool set.
 *
 * Each task: { ask, expectedTool, expectedParams?, hints? }
 * - tool-selection: 1 if routeAsk picks expectedTool, else 0.
 * - param-correctness: fraction of expectedParams keys recovered with the right
 *   value (1 when a task declares no expected params).
 *
 * @returns {{ toolSelectionRate:number, paramCorrectnessRate:number,
 *   combined:number, perTask:Array<object> }}
 */
export function scoreTaskSet(tasks, candidates) {
  const idf = buildIdf(candidates);
  const perTask = [];
  let toolHits = 0;
  let paramSum = 0;

  for (const task of tasks) {
    const routed = routeAsk(task.ask, candidates, idf);
    const toolOk = routed.tool === task.expectedTool;
    if (toolOk) toolHits += 1;

    const expected = task.expectedParams ?? {};
    const expectedKeys = Object.keys(expected);
    let paramScore = 1;
    let recovered = {};
    if (expectedKeys.length > 0) {
      recovered = extractParams(task.ask, task.hints);
      const hitKeys = expectedKeys.filter((k) => recovered[k] === expected[k]);
      paramScore = hitKeys.length / expectedKeys.length;
    }
    paramSum += paramScore;

    perTask.push({
      ask: task.ask,
      expectedTool: task.expectedTool,
      routedTool: routed.tool,
      toolOk,
      expectedParams: expected,
      recoveredParams: recovered,
      paramScore,
    });
  }

  const n = tasks.length || 1;
  const toolSelectionRate = toolHits / n;
  const paramCorrectnessRate = paramSum / n;
  return {
    toolSelectionRate,
    paramCorrectnessRate,
    combined: (toolSelectionRate + paramCorrectnessRate) / 2,
    perTask,
  };
}
