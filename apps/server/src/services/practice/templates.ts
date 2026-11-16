import { parseVariantId, seedFromString } from '@proginone/exercise-kit';
import type {
  ContentExercise,
  ContentRepository,
  ContentTemplate,
  TemplatePoolEntry,
} from '../../db/content/repository.ts';
import type { Orm } from '../../db/user/connection.ts';
import { servedVariants } from '../../db/user/practice-sets.ts';

/**
 * Template variant candidates for practice sets (FR-EX-08, D-057).
 *
 * Each template contributes at most one candidate per request: a variant from its verified seed
 * pool (D-056) that the learner has not been served yet and whose answer differs from the last
 * `minDistinctFromRecent` variants they saw; failing that, any unseen one; once the whole pool has
 * been served, the one served longest ago. The order among equally good seeds is a seeded shuffle
 * (seed = practice set ID), so a set is reproducible and different sets get different variants.
 * The engine then scores the candidate like any other exercise (variant group = template ID).
 */

/**
 * Templates the learner asked not to see: reporting one variant with "don't show again" excludes
 * the whole template, since a problem in one variant almost always comes from the template.
 */
export function excludedTemplates(excluded: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of excluded) {
    const parsed = parseVariantId(id);
    if (parsed) out.add(parsed.templateId);
  }
  return out;
}

/** Seeded order of a pool (stable for one set seed, different across sets). */
function shuffled(pool: readonly TemplatePoolEntry[], seed: string): TemplatePoolEntry[] {
  const key = new Map(pool.map((e) => [e.variantId, seedFromString(`${seed}#${e.variantId}`)]));
  return [...pool].sort((a, b) => {
    const ka = key.get(a.variantId) ?? 0n;
    const kb = key.get(b.variantId) ?? 0n;
    return ka < kb ? -1 : ka > kb ? 1 : a.sampleIndex - b.sampleIndex;
  });
}

/** Chooses the variant of one template to offer (see the module comment). */
export function chooseVariant(
  template: Pick<ContentTemplate, 'pool' | 'minDistinctFromRecent'>,
  served: readonly { exerciseId: string; at: number }[],
  seed: string,
): TemplatePoolEntry | null {
  if (template.pool.length === 0) return null;
  const answerOf = new Map(template.pool.map((e) => [e.variantId, e.answerKey]));
  const lastServed = new Map<string, number>();
  for (const s of served) lastServed.set(s.exerciseId, s.at);
  // Most recent first, one entry per variant.
  const recent = [...lastServed.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const recentAnswers = new Set(
    recent
      .slice(0, template.minDistinctFromRecent)
      .flatMap((id) => (answerOf.has(id) ? [answerOf.get(id) ?? ''] : [])),
  );
  const order = shuffled(template.pool, seed);
  const unseen = order.filter((e) => !lastServed.has(e.variantId));
  return (
    unseen.find((e) => !recentAnswers.has(e.answerKey)) ??
    unseen[0] ??
    [...order].sort(
      (a, b) => (lastServed.get(a.variantId) ?? 0) - (lastServed.get(b.variantId) ?? 0),
    )[0] ??
    null
  );
}

/**
 * One variant exercise per usable template, for the engine's candidate list. `excluded` holds
 * the learner's reported exercise IDs (a reported variant excludes its template).
 */
export function templateCandidates(input: {
  repo: ContentRepository;
  orm: Orm;
  learnerId: string;
  templates: readonly ContentTemplate[];
  seed: string;
  excluded: ReadonlySet<string>;
}): ContentExercise[] {
  const blocked = excludedTemplates(input.excluded);
  const templates = input.templates.filter((t) => !blocked.has(t.id));
  if (templates.length === 0) return [];
  const served = servedVariants(
    input.orm,
    input.learnerId,
    templates.map((t) => t.id),
  );
  const byTemplate = new Map<string, { exerciseId: string; at: number }[]>();
  for (const s of served) {
    const id = parseVariantId(s.exerciseId)?.templateId;
    if (id === undefined) continue;
    const list = byTemplate.get(id) ?? [];
    list.push(s);
    byTemplate.set(id, list);
  }
  return templates.flatMap((template) => {
    const chosen = chooseVariant(template, byTemplate.get(template.id) ?? [], input.seed);
    const exercise = chosen ? input.repo.getExercise(chosen.variantId) : null;
    return exercise ? [exercise] : [];
  });
}
