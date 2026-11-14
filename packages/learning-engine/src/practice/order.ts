import type { PlannedItem } from './candidates.ts';

/**
 * Removes runs of three items of the same type by swapping the third with the nearest later
 * item of another type, preferring one from the same difficulty band. Earlier positions are
 * never touched again, so the scan terminates. Runs that cannot be broken (e.g. one type left)
 * stay.
 */
export function breakTypeRuns(items: readonly PlannedItem[]): PlannedItem[] {
  const out = [...items];
  for (let i = 2; i < out.length; i++) {
    const a = out[i - 2];
    const b = out[i - 1];
    const c = out[i];
    if (a === undefined || b === undefined || c === undefined) continue;
    if (!(a.type === b.type && b.type === c.type)) continue;
    let swap = -1;
    for (let j = i + 1; j < out.length; j++) {
      const candidate = out[j];
      if (candidate === undefined || candidate.type === c.type) continue;
      if (candidate.band === c.band) {
        swap = j;
        break;
      }
      if (swap === -1) swap = j;
    }
    const other = out[swap];
    if (other !== undefined) {
      out[i] = other;
      out[swap] = c;
    }
  }
  return out;
}

/** Group key used for interleaving review items. */
export interface InterleaveKey {
  readonly concept: string;
  readonly module: string;
}

/**
 * Orders items so that the same concept never appears twice in a row and no more than two
 * items of the same module follow each other. Greedy: at each step take an allowed item whose
 * concept (then module) has the most items left, ties broken by `tieBreak`. When no item is
 * allowed (an impossible input), the constraint is relaxed for that step.
 */
export function interleave<T>(
  items: readonly T[],
  keyOf: (item: T) => InterleaveKey,
  tieBreak: (item: T) => number,
): T[] {
  const remaining = [...items];
  const out: T[] = [];
  const count = (pick: (k: InterleaveKey) => string, value: string) =>
    remaining.filter((item) => pick(keyOf(item)) === value).length;

  while (remaining.length > 0) {
    const last = out.at(-1);
    const prev = out.at(-2);
    const lastKey = last === undefined ? null : keyOf(last);
    const prevKey = prev === undefined ? null : keyOf(prev);
    const allowed = remaining.filter((item) => {
      const key = keyOf(item);
      if (lastKey !== null && key.concept === lastKey.concept) return false;
      return !(
        lastKey !== null &&
        prevKey !== null &&
        lastKey.module === key.module &&
        prevKey.module === key.module
      );
    });
    const pool = allowed.length > 0 ? allowed : remaining;
    let best: T | undefined;
    let bestRank: [number, number, number] = [-1, -1, Infinity];
    for (const item of pool) {
      const key = keyOf(item);
      const rank: [number, number, number] = [
        count((k) => k.concept, key.concept),
        count((k) => k.module, key.module),
        tieBreak(item),
      ];
      if (
        rank[0] > bestRank[0] ||
        (rank[0] === bestRank[0] &&
          (rank[1] > bestRank[1] || (rank[1] === bestRank[1] && rank[2] < bestRank[2])))
      ) {
        best = item;
        bestRank = rank;
      }
    }
    if (best === undefined) break;
    out.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return out;
}
