/**
 * Token contrast checker core: resolves semantic tokens in tokens.css to OKLCH colors
 * per theme and computes WCAG 2.x contrast ratios.
 *
 * Supported token value forms (anything else is an error, so the checker can't
 * silently skip a pair): `oklch(L C H)`, `var(--x)`, `light-dark(<value>, <value>)`.
 */

export type Scheme = 'light' | 'dark';

/** A theme context the checker evaluates. */
export interface Scenario {
  name: string;
  scheme: Scheme;
  /** Token overrides applied on top of `:root`, e.g. the `.workbench` remap. */
  overrides: ReadonlyMap<string, string>;
}

export interface TokenSheet {
  root: ReadonlyMap<string, string>;
  workbench: ReadonlyMap<string, string>;
}

export interface Pair {
  use: string;
  fg: string;
  bg: string;
  /** Minimum contrast ratio. 4.5 text, 7 body text goal, 3 non-text (WCAG 1.4.11). */
  min: number;
}

export interface PairResult extends Pair {
  scenario: string;
  ratio: number;
  ok: boolean;
}

type Oklch = readonly [l: number, c: number, h: number];

const DECLARATION = /--([\w-]+)\s*:\s*([^;]+);/g;

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(DECLARATION)) {
    out.set(m[1] ?? '', (m[2] ?? '').trim().replace(/\s+/g, ' '));
  }
  return out;
}

/**
 * Extracts custom properties from the `:root` block and the `.workbench` remap.
 * @throws Error if the `:root` block is missing.
 */
export function parseTokenSheet(css: string): TokenSheet {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let root: Map<string, string> | undefined;
  let workbench = new Map<string, string>();
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim();
    const body = m[2] ?? '';
    if (selector === ':root') root = declarations(body);
    else if (selector.includes('.workbench')) workbench = declarations(body);
  }
  if (!root) throw new Error('tokens.css has no `:root` block');
  return { root, workbench };
}

/** Splits `a, b` at the top-level comma (ignores commas inside parentheses). */
function splitArgs(args: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return [args.slice(0, i).trim(), args.slice(i + 1).trim()];
  }
  throw new Error(`expected two arguments: ${args}`);
}

function resolveValue(
  value: string,
  tokens: (name: string) => string | undefined,
  scheme: Scheme,
  seen: Set<string>,
): Oklch {
  const lightDark = /^light-dark\((.*)\)$/.exec(value);
  if (lightDark) {
    const [light, dark] = splitArgs(lightDark[1] ?? '');
    return resolveValue(scheme === 'light' ? light : dark, tokens, scheme, seen);
  }
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  if (ref) {
    const name = ref[1] ?? '';
    if (seen.has(name)) throw new Error(`circular token reference: --${name}`);
    const next = tokens(name);
    if (next === undefined) throw new Error(`unknown token: --${name}`);
    return resolveValue(next, tokens, scheme, new Set([...seen, name]));
  }
  const color = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (color) return [Number(color[1]), Number(color[2]), Number(color[3])];
  throw new Error(`unsupported token value: ${value}`);
}

/**
 * Resolves `--name` to an opaque OKLCH color in a scenario.
 * @throws Error for unknown tokens, cycles, or unsupported values (e.g. alpha colors).
 */
export function resolveToken(sheet: TokenSheet, scenario: Scenario, name: string): Oklch {
  const lookup = (n: string) => scenario.overrides.get(n) ?? sheet.root.get(n);
  return resolveValue(`var(--${name})`, lookup, scenario.scheme, new Set());
}

/** OKLCH → linear sRGB, clamped to gamut (same math as the M2 prototype checker). */
function toLinearSrgb([l, c, h]: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

function luminance(color: Oklch): number {
  const [r, g, b] = toLinearSrgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The three theme contexts: light, dark, and the opt-in dark workbench. */
export function scenariosOf(sheet: TokenSheet): Scenario[] {
  return [
    { name: '라이트', scheme: 'light', overrides: new Map() },
    { name: '다크', scheme: 'dark', overrides: new Map() },
    { name: '작업대(다크)', scheme: 'dark', overrides: sheet.workbench },
  ];
}

/** Evaluates every pair in every scenario. */
export function checkPairs(sheet: TokenSheet, pairs: readonly Pair[]): PairResult[] {
  return scenariosOf(sheet).flatMap((scenario) =>
    pairs.map((pair) => {
      const ratio = contrastRatio(
        resolveToken(sheet, scenario, pair.fg),
        resolveToken(sheet, scenario, pair.bg),
      );
      return { ...pair, scenario: scenario.name, ratio, ok: ratio >= pair.min };
    }),
  );
}
