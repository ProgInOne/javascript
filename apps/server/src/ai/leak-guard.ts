import type { OutputGuard } from '@proginone/ai';
import { normalizeLeakText } from '@proginone/exercise-kit';

// Answer-leak post-check of AI output (docs/design/ai-system.md#tutorhint "후처리 누설 검사", D-010).
// Fingerprints come from the content build (`exercises.leak_fingerprints_json`, already
// normalized with `normalizeLeakText`); output is normalized the same way before matching.

/** Fingerprints shorter than this are ignored: "2" or ";" would match ordinary explanations. */
export const MIN_FINGERPRINT_LENGTH = 3;
/** Fingerprints up to this length must match as a whole token, longer ones as a substring. */
export const TOKEN_MATCH_MAX_LENGTH = 5;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds the guard for one exercise, or `null` when nothing can be checked. Violation labels are
 * `fp:<index>`, never the fingerprint text (it is the answer).
 */
export function leakGuard(fingerprints: readonly string[]): OutputGuard | null {
  const matchers = fingerprints
    .map((fp, i) => ({ fp: normalizeLeakText(fp), label: `fp:${i}` }))
    .filter(({ fp }) => fp.length >= MIN_FINGERPRINT_LENGTH)
    .map(({ fp, label }) => {
      if (fp.length > TOKEN_MATCH_MAX_LENGTH) {
        return { label, length: fp.length, test: (text: string) => text.includes(fp) };
      }
      const re = new RegExp(`(?<![A-Za-z0-9_$])${escape(fp)}(?![A-Za-z0-9_$])`);
      return { label, length: fp.length, test: (text: string) => re.test(text) };
    });
  if (matchers.length === 0) return null;
  const longest = Math.max(...matchers.map((m) => m.length));
  return {
    // Raw text may carry extra whitespace the normalization collapses; hold back generously.
    holdback: Math.min(800, longest * 2 + 16),
    findViolations: (text) => {
      const normalized = normalizeLeakText(text);
      return matchers.filter((m) => m.test(normalized)).map((m) => m.label);
    },
  };
}
