/**
 * Text normalization rules from docs/design/content-and-exercises.md
 * (#fill_blank-빈칸-채우기, #predict_output-실행-결과-예측).
 */

/** Full-width ASCII (U+FF01..U+FF5E) and the ideographic space → half-width. */
export function toHalfWidth(text: string): string {
  return text.replace(/[\uFF01-\uFF5E\u3000]/g, (ch) =>
    ch === '\u3000' ? ' ' : String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/** Typographic quotes that IMEs and word processors insert → ASCII quotes. */
export function unifySmartQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"');
}

/** Trims and collapses every whitespace run to one space. */
export function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Normalization for answer-leak fingerprints. The AI hint checker applies the same function to
 * hint text before substring matching.
 */
export function normalizeLeakText(text: string): string {
  return collapseWhitespace(unifySmartQuotes(toHalfWidth(text)));
}

/** Normalized, deduplicated, non-empty fingerprints. */
export function leakSet(values: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = normalizeLeakText(value);
    if (normalized !== '') out.add(normalized);
  }
  return [...out];
}

/** `fill_blank` text-mode normalization. */
export function normalizeBlankText(text: string, caseSensitive: boolean): string {
  const normalized = collapseWhitespace(unifySmartQuotes(toHalfWidth(text)));
  return caseSensitive ? normalized : normalized.toLowerCase();
}

const QUOTES = new Set(["'", '"', '`']);

/**
 * When `text` is one string literal wrapped in `'`, `"` or `` ` `` (no unescaped inner quote of
 * the same kind), returns its inner text; otherwise null. Used to make quote kinds equivalent.
 */
export function unquoteLiteral(text: string): string | null {
  if (text.length < 2) return null;
  const quote = text[0];
  if (quote === undefined || !QUOTES.has(quote) || !text.endsWith(quote)) return null;
  const inner = text.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\') i++;
    else if (inner[i] === quote) return null;
  }
  return inner;
}

/**
 * Output normalization for `predict_output` console answers: CRLF/CR → LF, trailing spaces per
 * line removed, trailing empty lines removed.
 */
export function normalizeOutputLines(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
