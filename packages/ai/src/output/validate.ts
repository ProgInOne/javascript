import type { ValidationIssue } from '../record.ts';

/**
 * Checks AI output against content that must not appear in it (answer-leak fingerprints).
 * The server implements it with the same normalization as the content build
 * (exercise-kit `normalizeLeakText`); packages/ai only knows the interface.
 */
export interface OutputGuard {
  /**
   * Longest raw text one violation can span. A streaming task holds back this many trailing
   * characters so a violation is caught before any part of it reaches the screen.
   */
  holdback: number;
  /** Labels of the violated rules (never the matched answer text). Empty when clean. */
  findViolations(text: string): string[];
}

/** Lines inside fenced code blocks; an unclosed fence counts to the end. */
export function countCodeLines(markdown: string): number {
  let inFence = false;
  let count = 0;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line.trim() !== '') count++;
  }
  return count;
}

export function leakIssues(violations: readonly string[]): ValidationIssue[] {
  return violations.length === 0
    ? []
    : [{ rule: 'answer_leak', message: `정답 누설 규칙 ${violations.length}개에 걸렸습니다.` }];
}

/** True for issues that are policy violations (retry once, then fallback or withhold). */
export function isPolicyIssue(issue: ValidationIssue): boolean {
  return issue.rule !== 'schema' && issue.rule !== 'syntax';
}
