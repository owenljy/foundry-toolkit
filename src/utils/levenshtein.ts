/**
 * Levenshtein distance + closest-match helpers for typo detection.
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/**
 * Find the closest candidate to `target` within a max edit distance.
 * Distance threshold scales with word length so short fields aren't
 * over-matched. Returns undefined if nothing is close enough.
 */
export function closestMatch(target: string, candidates: string[]): string | undefined {
  const maxDistance = target.length <= 4 ? 1 : target.length <= 8 ? 2 : 3;
  let best: string | undefined;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const d = levenshtein(target.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  return best !== undefined && bestDistance <= maxDistance && bestDistance > 0 ? best : undefined;
}
