import type { CssComparator } from './schema.ts';

/**
 * Comparison of computed CSS values (docs/design/content-and-exercises.md#css-체크):
 * lengths as px with tolerance, colors by CIEDE2000 distance, keywords case-insensitively.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
};

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const RGB_FN = new RegExp(
  String.raw`^rgba?\(\s*(${NUMBER})(%?)\s*[,\s]\s*(${NUMBER})(%?)\s*[,\s]\s*(${NUMBER})(%?)\s*(?:[,/]\s*(${NUMBER})(%?)\s*)?\)$`,
  'i',
);

/** Parses `rgb()`/`rgba()`, hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) and basic named colors. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase();
  const named = NAMED[text];
  if (named) return named;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? hex.replace(/./g, (c) => c + c) : hex;
    const byte = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
  }
  const m = RGB_FN.exec(text);
  if (!m) return null;
  const channel = (value: string | undefined, percent: string | undefined) => {
    const n = Number(value);
    return clamp(percent === '%' ? (n * 255) / 100 : n, 0, 255);
  };
  const alpha =
    m[7] === undefined ? 1 : clamp(m[8] === '%' ? Number(m[7]) / 100 : Number(m[7]), 0, 1);
  return { r: channel(m[1], m[2]), g: channel(m[3], m[4]), b: channel(m[5], m[6]), a: alpha };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** sRGB (0..255) → CIELAB (D65). */
export function toLab({ r, g, b }: Rgba): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 color difference (Sharma, Wu, Dalal 2005). */
export function deltaE2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

function normalizeKeyword(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Parses a computed length like `16px` / `-2.5px`; anything else (auto, %, normal) is null. */
export function parsePx(value: string): number | null {
  const m = new RegExp(`^(${NUMBER})px$`, 'i').exec(value.trim());
  return m ? Number(m[1]) : null;
}

function parseNumber(value: string): number | null {
  const text = value.trim();
  return new RegExp(`^${NUMBER}$`, 'i').test(text) ? Number(text) : null;
}

function inBounds(
  n: number,
  bounds: { value?: number | undefined; min?: number | undefined; max?: number | undefined },
  tolerance: number,
): boolean {
  if (bounds.value !== undefined && Math.abs(n - bounds.value) > tolerance) return false;
  if (bounds.min !== undefined && n < bounds.min - tolerance) return false;
  if (bounds.max !== undefined && n > bounds.max + tolerance) return false;
  return true;
}

/** Applies one comparator to an observed computed value. */
export function cssValueMatches(comparator: CssComparator, observed: string): boolean {
  if ('equals' in comparator)
    return normalizeKeyword(observed) === normalizeKeyword(comparator.equals);
  if ('oneOf' in comparator) {
    const value = normalizeKeyword(observed);
    return comparator.oneOf.some((option) => normalizeKeyword(option) === value);
  }
  if ('px' in comparator) {
    const n = parsePx(observed);
    return n !== null && inBounds(n, comparator.px, comparator.px.tolerance);
  }
  if ('numeric' in comparator) {
    const n = parseNumber(observed);
    return n !== null && inBounds(n, comparator.numeric, 1e-9);
  }
  const expected = parseColor(comparator.color);
  const actual = parseColor(observed);
  if (!expected || !actual) return false;
  if (Math.abs(expected.a - actual.a) > 0.05) return false;
  if (expected.a === 0) return true;
  return deltaE2000(toLab(expected), toLab(actual)) <= comparator.deltaE;
}

/** Short Korean description of a comparator, for visible-check feedback. */
export function describeComparator(comparator: CssComparator): string {
  if ('equals' in comparator) return comparator.equals;
  if ('oneOf' in comparator) return comparator.oneOf.join(' 또는 ');
  const bounds = (
    b: { value?: number | undefined; min?: number | undefined; max?: number | undefined },
    unit: string,
  ) =>
    b.value !== undefined
      ? `${b.value}${unit}`
      : [
          b.min === undefined ? '' : `${b.min}${unit} 이상`,
          b.max === undefined ? '' : `${b.max}${unit} 이하`,
        ]
          .filter(Boolean)
          .join(' ');
  if ('px' in comparator) return bounds(comparator.px, 'px');
  if ('numeric' in comparator) return bounds(comparator.numeric, '');
  return `${comparator.color} 근처 색`;
}
