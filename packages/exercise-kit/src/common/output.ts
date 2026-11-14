import { parseLiteral } from './literal.ts';
import {
  collapseWhitespace,
  normalizeOutputLines,
  toHalfWidth,
  unifySmartQuotes,
} from './normalize.ts';
import { valuesEqual } from './values.ts';

/**
 * Line comparison for console output (predict_output `console`, `console` checks).
 * docs/design/content-and-exercises.md#predict_output-실행-결과-예측:
 * a line that parses as a JavaScript literal on both sides is compared structurally
 * (`[1,'a']` equals `[1, "a"]`); otherwise lines are compared after whitespace normalization.
 */
export function outputLineEquals(expected: string, actual: string): boolean {
  const e = prepareLine(expected);
  const a = prepareLine(actual);
  const ev = parseLiteral(e);
  if (ev !== null) {
    const av = parseLiteral(a);
    if (av !== null) return valuesEqual(ev, av);
  }
  return collapseWhitespace(e) === collapseWhitespace(a);
}

/** Learner-typed text: full-width → half-width, smart quotes → ASCII. Applied to both sides. */
export function prepareLine(line: string): string {
  return unifySmartQuotes(toHalfWidth(line)).trim();
}

export interface LineComparison {
  /** Normalized expected and actual lines. */
  expected: string[];
  actual: string[];
  /** Per expected/actual index (up to the longer list): whether that line matches. */
  matches: boolean[];
  matched: number;
  /** `max(expected, actual)` lines; extra learner lines count against the score. */
  total: number;
  equal: boolean;
}

/** Compares output line by line, in order. */
export function compareOutput(
  expectedText: string | readonly string[],
  actualText: string,
): LineComparison {
  const expected = normalizeOutputLines(
    typeof expectedText === 'string' ? expectedText : expectedText.join('\n'),
  );
  const actual = normalizeOutputLines(actualText);
  const total = Math.max(expected.length, actual.length);
  const matches: boolean[] = [];
  for (let i = 0; i < total; i++) {
    const e = expected[i];
    const a = actual[i];
    matches.push(e !== undefined && a !== undefined && outputLineEquals(e, a));
  }
  const matched = matches.filter(Boolean).length;
  return { expected, actual, matches, matched, total, equal: matched === total };
}
