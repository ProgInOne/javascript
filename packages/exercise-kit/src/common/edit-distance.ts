/**
 * Token edit distance for `fix_bug.maxEditDistance` ("버그만 고쳐 보세요" rule).
 * Comments and whitespace are ignored; identifiers, numbers, strings and punctuation are tokens.
 */

const TOKEN =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\S/g;
const MAX_TOKENS = 50_000;

export function tokenize(code: string): string[] {
  const tokens: string[] = [];
  for (const match of code.matchAll(TOKEN)) {
    const token = match[0];
    if (token.startsWith('//') || token.startsWith('/*') || token.startsWith('<!--')) continue;
    tokens.push(token);
    if (tokens.length > MAX_TOKENS) break;
  }
  return tokens;
}

/**
 * Whether the Levenshtein distance between two token lists exceeds `limit`.
 * Banded dynamic programming: O(n · limit) time, O(limit) memory.
 */
export function editDistanceExceeds(
  a: readonly string[],
  b: readonly string[],
  limit: number,
): boolean {
  if (Math.abs(a.length - b.length) > limit) return true;
  const INF = limit + 1;
  const width = 2 * limit + 1;
  // prev[k] holds the distance for column j = i - limit + k of the previous row.
  let prev = new Array<number>(width).fill(INF);
  for (let k = 0; k < width; k++) {
    const j = k - limit;
    if (j >= 0 && j <= b.length) prev[k] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array<number>(width).fill(INF);
    let rowMin = INF;
    for (let k = 0; k < width; k++) {
      const j = i - limit + k;
      if (j < 0 || j > b.length) continue;
      if (j === 0) {
        curr[k] = i;
      } else {
        const substitution = (prev[k] ?? INF) + (a[i - 1] === b[j - 1] ? 0 : 1);
        const deletion = (prev[k + 1] ?? INF) + 1; // from (i-1, j)
        const insertion = (curr[k - 1] ?? INF) + 1; // from (i, j-1)
        curr[k] = Math.min(substitution, deletion, insertion, INF);
      }
      rowMin = Math.min(rowMin, curr[k] ?? INF);
    }
    if (rowMin > limit) return true;
    prev = curr;
  }
  return (prev[b.length - a.length + limit] ?? INF) > limit;
}
