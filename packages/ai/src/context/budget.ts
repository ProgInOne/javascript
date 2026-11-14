// Conservative token estimate without a tokenizer (docs/design/ai-system.md#contextbuilder와-contextsource):
// one Hangul syllable ≈ 1 token, other text (English, code) ≈ 4 characters per token.

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/g;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const hangul = text.match(HANGUL)?.length ?? 0;
  return hangul + Math.ceil((text.length - hangul) / 4);
}

/**
 * Cuts `text` so its estimate fits `maxTokens`, keeping the start and marking the cut.
 * Used for required sections that are still too long in their most compact form.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const marker = '\n…(생략)';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid) + marker) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + marker;
}

/** Keeps the last `maxLines` lines (console output, long code around the end). */
export function tailLines(lines: readonly string[], maxLines: number): string[] {
  return lines.length <= maxLines ? [...lines] : lines.slice(lines.length - maxLines);
}
