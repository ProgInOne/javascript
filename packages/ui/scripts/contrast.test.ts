import { describe, expect, it } from 'vitest';
import {
  checkPairs,
  contrastRatio,
  hexToOklch,
  parseTokenSheet,
  resolveToken,
  scenariosOf,
} from './contrast.ts';

const CSS = `
/* comment { with braces } */
:root {
  --white: oklch(1 0 0);
  --black: oklch(0 0 0);
  --grey: oklch(0.7 0 0);
  --fg: light-dark(var(--black), var(--white));
  --bg: light-dark(var(--white), var(--black));
  --weak: var(--grey);
  color-scheme: light dark;
}
:root[data-theme='dark'] { color-scheme: dark; }
:root[data-workbench='dark'] .workbench { --bg: var(--grey); }
`;

describe('parseTokenSheet', () => {
  it('reads :root tokens and the workbench remap', () => {
    const sheet = parseTokenSheet(CSS);
    expect(sheet.root.get('fg')).toBe('light-dark(var(--black), var(--white))');
    expect(sheet.workbench.get('bg')).toBe('var(--grey)');
  });

  it('throws without a :root block', () => {
    expect(() => parseTokenSheet('.x { --a: oklch(1 0 0); }')).toThrow(/:root/);
  });
});

describe('resolveToken', () => {
  const sheet = parseTokenSheet(CSS);
  const [light, dark, workbench] = scenariosOf(sheet);

  it('picks the light-dark() branch for the scenario scheme', () => {
    if (!light || !dark || !workbench) throw new Error('missing scenario');
    expect(resolveToken(sheet, light, 'fg')).toEqual([0, 0, 0]);
    expect(resolveToken(sheet, dark, 'fg')).toEqual([1, 0, 0]);
    expect(resolveToken(sheet, workbench, 'bg')).toEqual([0.7, 0, 0]);
  });

  it('rejects unknown tokens and unsupported values', () => {
    if (!light) throw new Error('missing scenario');
    expect(() => resolveToken(sheet, light, 'missing')).toThrow(/unknown token/);
    const alpha = parseTokenSheet(':root { --a: oklch(0 0 0 / 0.5); }');
    expect(() => resolveToken(alpha, light, 'a')).toThrow(/unsupported/);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colors', () => {
    expect(contrastRatio([0, 0, 0], [1, 0, 0])).toBeCloseTo(21, 1);
    expect(contrastRatio([0.5, 0.1, 168], [0.5, 0.1, 168])).toBe(1);
  });
});

describe('checkPairs', () => {
  it('flags a pair that misses its target in any scenario', () => {
    const sheet = parseTokenSheet(CSS);
    const results = checkPairs(sheet, [{ use: 'weak', fg: 'weak', bg: 'bg', min: 4.5 }]);
    expect(results.map((r) => [r.scenario, r.ok])).toEqual([
      ['라이트', false],
      ['다크', true],
      ['작업대(다크)', false],
    ]);
  });
});

describe('hexToOklch', () => {
  it('converts sRGB hex to OKLCH', () => {
    const [l, c] = hexToOklch('ffffff');
    expect(l).toBeCloseTo(1, 3);
    expect(c).toBeCloseTo(0, 3);
    const [black] = hexToOklch('000000');
    expect(black).toBeCloseTo(0, 3);
  });

  it('lets token sheets use #rrggbb values', () => {
    const sheet = parseTokenSheet(':root { --w: #ffffff; --b: #000000; --g: #00c471; }');
    const [light] = scenariosOf(sheet);
    if (!light) throw new Error('missing scenario');
    const ratio = (a: string, b: string) =>
      contrastRatio(resolveToken(sheet, light, a), resolveToken(sheet, light, b));
    expect(ratio('w', 'b')).toBeCloseTo(21, 0);
    // White on the brand fill misses AA (D-076).
    expect(ratio('w', 'g')).toBeCloseTo(2.3, 1);
  });
});
