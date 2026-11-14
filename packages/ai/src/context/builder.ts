import type { ContextManifestEntry } from '../record.ts';
import { estimateTokens, truncateToTokens } from './budget.ts';
import type { ContextSource } from './source.ts';

/** A loaded section: rendered variants from the fullest to the most compact. */
export interface LoadedSection {
  kind: string;
  ref: string | null;
  variants: string[];
}

export interface ContextEnv {
  /** The provider thread is new: include the conversation so far. */
  rehydrate: boolean;
}

export interface ContextSectionSpec<I> {
  kind: string;
  /** Required sections are never dropped; when too long their most compact form is cut. */
  required: boolean | ((input: I) => boolean);
  /** Higher survives longer (docs/design/ai-system.md#컨텍스트-조립-우선순위). */
  priority: number;
  maxTokens: number;
  load(src: ContextSource, input: I, env: ContextEnv): Promise<LoadedSection | null>;
}

export interface ContextSpec<I> {
  sections: ContextSectionSpec<I>[];
  totalBudgetTokens: number;
}

export interface BuiltContext {
  /** Rendered sections in spec order (excluded ones omitted). */
  blocks: string[];
  manifest: ContextManifestEntry[];
  estimatedTokens: number;
}

/** Floor for a required section when the budget is already spent. */
const REQUIRED_FLOOR_TOKENS = 200;

/**
 * Memoizes ContextSource reads for one build so sections can share lookups (the learner state
 * section needs the exercise's concepts, for example) without querying twice.
 */
export function memoizeSource(src: ContextSource): ContextSource {
  const cache = new Map<string, Promise<unknown>>();
  const memo = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    let hit = cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = load();
      cache.set(key, hit);
    }
    return hit;
  };
  return {
    conceptStates: (ids) =>
      memo(`concepts:${JSON.stringify([...ids].sort())}`, () => src.conceptStates(ids)),
    exercise: (id, access) =>
      memo(`exercise:${id}:${JSON.stringify(access)}`, () => src.exercise(id, access)),
    attempts: (id, opts) => memo(`attempts:${id}:${opts.limit}`, () => src.attempts(id, opts)),
    lesson: (id, opts) => memo(`lesson:${id}:${opts.sectionId ?? ''}`, () => src.lesson(id, opts)),
    threadMessages: (id, opts) =>
      memo(`messages:${id}:${opts.limit}:${opts.excludeMessageIds.join(',')}`, () =>
        src.threadMessages(id, opts),
      ),
  };
}

/**
 * Assembles a task's context within its token budget: sections are given budget in descending
 * priority; each takes its fullest variant that fits, a lower-priority section that cannot fit
 * is excluded, and a required one is cut to fit.
 */
export async function buildContext<I>(
  spec: ContextSpec<I>,
  source: ContextSource,
  input: I,
  env: ContextEnv,
): Promise<BuiltContext> {
  const src = memoizeSource(source);
  const loaded = await Promise.all(spec.sections.map((s) => s.load(src, input, env)));
  const order = spec.sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.priority - a.s.priority || a.i - b.i);

  let remaining = spec.totalBudgetTokens;
  const chosen = new Map<number, { text: string; tokens: number; truncated: boolean }>();
  const manifest = new Map<number, ContextManifestEntry>();

  for (const { s, i } of order) {
    const section = loaded[i];
    if (!section || section.variants.length === 0) continue;
    const required = typeof s.required === 'function' ? s.required(input) : s.required;
    const cap = Math.min(s.maxTokens, Math.max(remaining, required ? REQUIRED_FLOOR_TOKENS : 0));
    const fits = section.variants.findIndex((v) => estimateTokens(v) <= cap);
    let pick: { text: string; tokens: number; truncated: boolean } | null = null;
    if (fits >= 0) {
      const text = section.variants[fits] ?? '';
      pick = { text, tokens: estimateTokens(text), truncated: fits > 0 };
    } else if (required) {
      const text = truncateToTokens(section.variants.at(-1) ?? '', cap);
      pick = { text, tokens: estimateTokens(text), truncated: true };
    }
    if (pick) {
      chosen.set(i, pick);
      remaining -= pick.tokens;
    }
    manifest.set(i, {
      kind: section.kind,
      ref: section.ref,
      estimatedTokens: pick?.tokens ?? 0,
      truncated: pick?.truncated ?? true,
      included: pick !== null,
    });
  }

  const blocks: string[] = [];
  const entries: ContextManifestEntry[] = [];
  let estimatedTokens = 0;
  spec.sections.forEach((_s, i) => {
    const pick = chosen.get(i);
    if (pick) {
      blocks.push(pick.text);
      estimatedTokens += pick.tokens;
    }
    const entry = manifest.get(i);
    if (entry) entries.push(entry);
  });
  return { blocks, manifest: entries, estimatedTokens };
}
