import { describe, expect, it } from 'vitest';
import { parseTutorReply } from '../tasks/tutor-reply.ts';
import { StreamGate } from './stream.ts';
import { countCodeLines } from './validate.ts';

function gate(opts: { stripMeta?: boolean; leak?: RegExp; holdback?: number } = {}) {
  const shown: string[] = [];
  const violations: string[][] = [];
  const g = new StreamGate({
    stripMeta: opts.stripMeta ?? true,
    guard: opts.leak
      ? {
          holdback: opts.holdback ?? 20,
          findViolations: (t) => (opts.leak?.test(t) ? ['fp'] : []),
        }
      : undefined,
    emit: (t) => shown.push(t),
    onViolation: (v) => violations.push(v),
  });
  return { g, shown, violations };
}

describe('StreamGate', () => {
  it('hides a <meta> block split across deltas', () => {
    const { g, shown } = gate();
    for (const d of ['답변', ' 본문<', 'me', 'ta>{"a":1}</meta>']) g.push(d);
    expect(g.finish()).toBe(true);
    expect(shown.join('')).toBe('답변 본문');
    expect(g.visibleText()).toBe('답변 본문');
  });

  it('shows a trailing "<m" that turned out not to be meta', () => {
    const { g, shown } = gate();
    g.push('a <m');
    expect(shown.join('')).toBe('a ');
    g.finish();
    expect(shown.join('')).toBe('a <m');
  });

  it('holds back the tail and stops on a violation before it is shown', () => {
    const { g, shown, violations } = gate({ leak: /SECRET/, holdback: 10 });
    g.push('안전한 앞부분 텍스트가 충분히 길어요. ');
    const before = shown.join('');
    expect(before.length).toBeGreaterThan(0);
    g.push('SEC');
    g.push('RET 정답');
    expect(violations).toHaveLength(1);
    expect(shown.join('')).not.toContain('SEC');
    expect(g.finish()).toBe(false);
  });
});

describe('parseTutorReply', () => {
  it('ignores an invalid meta block', () => {
    expect(parseTutorReply('본문\n<meta>{oops</meta>')).toEqual({ markdown: '본문', meta: null });
  });

  it('accepts a reply without meta', () => {
    expect(parseTutorReply('  본문  ')).toEqual({ markdown: '본문', meta: null });
  });
});

describe('countCodeLines', () => {
  it('counts non-empty lines in fences, including an unclosed one', () => {
    expect(countCodeLines('a\n```js\nx\n\ny\n```\nb\n```\nz')).toBe(3);
  });
});
