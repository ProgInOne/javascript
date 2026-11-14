import { describe, expect, it } from 'vitest';

import {
  exerciseOriginOf,
  formatSeed,
  formatVariantId,
  isSlug,
  isTemplateId,
  parseSeed,
  parseVariantId,
  variantGroupKey,
} from './ids.ts';

const TEMPLATE = 'js-basics.functions.function-basics.t.predict-return';

describe('identifiers', () => {
  it('validates slugs', () => {
    expect(isSlug('js-basics.functions.function-basics')).toBe(true);
    expect(isSlug('Js.basics')).toBe(false);
    expect(isSlug('a--b')).toBe(false);
    expect(isSlug('a.'.repeat(70) + 'a')).toBe(false);
    expect(isTemplateId(TEMPLATE)).toBe(true);
    expect(isTemplateId('js-basics.functions.function-basics.mcq-x')).toBe(false);
  });

  it('round-trips canonical seeds and rejects non-canonical ones', () => {
    expect(formatSeed(0xa91f2cn)).toBe('a91f2c');
    expect(parseSeed('a91f2c')).toBe(0xa91f2cn);
    expect(parseSeed('0')).toBe(0n);
    expect(parseSeed('ffffffffffffffff')).toBe((1n << 64n) - 1n);
    for (const bad of ['', '00a', 'A91F2C', '1ffffffffffffffff', '-1', 'xyz']) {
      expect(parseSeed(bad), bad).toBeNull();
    }
    expect(() => formatSeed(-1n)).toThrow(RangeError);
    expect(() => formatSeed(1n << 64n)).toThrow(RangeError);
  });

  it('formats and parses variant IDs', () => {
    const id = formatVariantId(TEMPLATE, 0xa91f2cn);
    expect(id).toBe(`${TEMPLATE}@a91f2c`);
    expect(parseVariantId(id)).toEqual({ templateId: TEMPLATE, seed: 0xa91f2cn });
    expect(parseVariantId(`${TEMPLATE}@0a`)).toBeNull();
    expect(parseVariantId('js-basics.functions.function-basics.mcq-x@a1')).toBeNull();
    expect(parseVariantId('@a1')).toBeNull();
  });

  it('infers exercise origin and variant group keys', () => {
    expect(exerciseOriginOf('js-basics.functions.function-basics.mcq-return-vs-log')).toBe(
      'authored',
    );
    expect(exerciseOriginOf(`${TEMPLATE}@1f`)).toBe('template');
    expect(exerciseOriginOf('gen.01JD3Z8Q6V2K9M4T7R1X5W0BNC')).toBe('generated');
    expect(exerciseOriginOf('gen.nope')).toBeNull();
    expect(exerciseOriginOf(TEMPLATE)).toBeNull();
    expect(variantGroupKey({ id: `${TEMPLATE}@1f` })).toBe(TEMPLATE);
    expect(variantGroupKey({ id: 'a.b.c.d', variantGroup: 'g' })).toBe('g');
    expect(variantGroupKey({ id: 'a.b.c.d', variantGroup: null })).toBe('a.b.c.d');
  });
});
