/**
 * Deterministic PRNG for templates and option shuffling
 * (docs/design/content-and-exercises.md#결정론적-생성).
 *
 * - `xoshiro128**` (Blackman & Vigna) generates 32-bit outputs with plain 32-bit integer math,
 *   so results are bit-identical on every JavaScript engine and machine.
 * - Its 128-bit state is filled from the 64-bit seed with SplitMix64 (the seeding procedure the
 *   xoshiro authors recommend), computed with BigInt.
 * - Never `Math.random`.
 */

const MASK64 = (1n << 64n) - 1n;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;

/** One SplitMix64 step: returns the next state and the output. */
export function splitmix64(state: bigint): { state: bigint; value: bigint } {
  const next = (state + GOLDEN_GAMMA) & MASK64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return { state: next, value: z ^ (z >> 31n) };
}

/** Next seed in a deterministic chain (constraint retries). */
export function deriveSeed(seed: bigint): bigint {
  return splitmix64(seed & MASK64).value;
}

export interface Rng {
  /** Uniform integer in [0, 2^32). */
  nextUint32(): number;
  /** Uniform integer in [min, max] (inclusive), without modulo bias. */
  int(min: number, max: number): number;
  /** Fisher–Yates shuffle into a new array. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Raw xoshiro128** over an explicit 4×32-bit state (exported for known-answer tests). */
export function xoshiro128ss(state: [number, number, number, number]): () => number {
  let [s0, s1, s2, s3] = state.map((v) => v >>> 0) as [number, number, number, number];
  return () => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Creates an {@link Rng} from a 64-bit seed. */
export function createRng(seed: bigint): Rng {
  const a = splitmix64(seed & MASK64);
  const b = splitmix64(a.state);
  const words: [number, number, number, number] = [
    Number(a.value >> 32n),
    Number(a.value & 0xffffffffn),
    Number(b.value >> 32n),
    Number(b.value & 0xffffffffn),
  ];
  // An all-zero state would stay zero forever; SplitMix64 makes it practically impossible.
  if (words.every((w) => w === 0)) words[0] = 1;
  const next = xoshiro128ss(words);

  const rng: Rng = {
    nextUint32: next,
    int(min, max) {
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
        throw new RangeError(`invalid range [${min}, ${max}]`);
      }
      const span = max - min + 1;
      if (span > 0x1_0000_0000) throw new RangeError('range wider than 2^32');
      if (span === 0x1_0000_0000) return min + next();
      // Rejection sampling: discard the biased tail of the 32-bit space.
      const limit = 0x1_0000_0000 - (0x1_0000_0000 % span);
      let x = next();
      while (x >= limit) x = next();
      return min + (x % span);
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
  return rng;
}

/** FNV-1a 64 over UTF-8 bytes, then one SplitMix64 mix. Maps any string to a 64-bit seed. */
export function seedFromString(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of utf8(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & MASK64;
  }
  return splitmix64(hash).value;
}

/** UTF-8 bytes without relying on `TextEncoder` (not in the ES lib this package targets). */
function* utf8(text: string): Generator<number> {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) yield cp;
    else if (cp < 0x800) {
      yield 0xc0 | (cp >> 6);
      yield 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      yield 0xe0 | (cp >> 12);
      yield 0x80 | ((cp >> 6) & 0x3f);
      yield 0x80 | (cp & 0x3f);
    } else {
      yield 0xf0 | (cp >> 18);
      yield 0x80 | ((cp >> 12) & 0x3f);
      yield 0x80 | ((cp >> 6) & 0x3f);
      yield 0x80 | (cp & 0x3f);
    }
  }
}
