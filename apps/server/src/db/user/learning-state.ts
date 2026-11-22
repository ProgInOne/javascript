import type {
  ConceptMemoryState,
  ConceptState,
  EvidenceFact,
  FsrsPort,
  FsrsRating,
  MasteryEvidenceRecord,
  MasteryUpdate,
  ReviewFact,
  ReviewLogRecord,
} from '@proginone/learning-engine';
import { and, asc, count, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { breakdownJson, cardJson, revlogJson, stringListJson } from './json.ts';
import { forWrite, fromRow } from './json-io.ts';
import { newId } from './learners.ts';
import { attempts, conceptMastery, conceptMemory, masteryEvidence, reviewLogs } from './schema.ts';

// Learner model per concept: concept_mastery + mastery_evidence (mastery model) and
// concept_memory + review_logs (FSRS). Reads assemble the engine's `ConceptState`
// (the @proginone/learning-engine README in ProgInOne/core has the column mapping); writes take engine outputs.

const ms = (d: Date | null) => (d === null ? null : d.getTime());

/**
 * The engine state of each concept the learner has any record of. Concepts without rows are
 * absent (the engine starts them from `not_started`).
 */
export function loadConceptStates(
  orm: Orm,
  learnerId: string,
  conceptIds: readonly string[],
  fsrs: FsrsPort,
): Map<string, ConceptState> {
  const ids = [...new Set(conceptIds)];
  const out = new Map<string, ConceptState>();
  if (ids.length === 0) return out;

  const history = new Map<string, EvidenceFact[]>();
  for (const row of orm
    .select({
      id: masteryEvidence.id,
      conceptId: masteryEvidence.conceptId,
      breakdown: masteryEvidence.breakdownJson,
    })
    .from(masteryEvidence)
    .where(
      and(
        eq(masteryEvidence.learnerId, learnerId),
        inArray(masteryEvidence.conceptId, ids),
        eq(masteryEvidence.kind, 'attempt'),
      ),
    )
    .all()) {
    const fact = fromRow(breakdownJson, row.breakdown, 'mastery_evidence', row.id).fact;
    if (!fact) continue;
    const list = history.get(row.conceptId) ?? [];
    list.push(fact);
    history.set(row.conceptId, list);
  }

  const reviews = loadReviewFacts(orm, learnerId, ids);

  const memory = new Map<string, ConceptMemoryState>();
  for (const row of orm
    .select()
    .from(conceptMemory)
    .where(and(eq(conceptMemory.learnerId, learnerId), inArray(conceptMemory.conceptId, ids)))
    .all()) {
    memory.set(row.conceptId, {
      conceptId: row.conceptId,
      card: fsrs.fromRaw(fromRow(cardJson, row.cardJson, 'concept_memory', row.conceptId)),
      fsrsVersion: row.fsrsVersion,
      suspended: row.suspended,
    });
  }

  for (const row of orm
    .select()
    .from(conceptMastery)
    .where(and(eq(conceptMastery.learnerId, learnerId), inArray(conceptMastery.conceptId, ids)))
    .all()) {
    out.set(row.conceptId, {
      mastery: {
        conceptId: row.conceptId,
        score: row.score,
        stage: row.stage,
        evidenceWeightSum: row.evidenceWeightSum,
        distinctTypesCorrect: fromRow(
          stringListJson,
          row.distinctTypesCorrectJson,
          'concept_mastery',
          row.conceptId,
        ),
        maxDifficultyCorrect: row.maxDifficultyCorrect,
        consecutiveFailures: row.consecutiveFailures,
        lastAttemptAt: ms(row.lastAttemptAt),
        stageChangedAt: ms(row.stageChangedAt),
      },
      history: history.get(row.conceptId) ?? [],
      reviews: reviews.get(row.conceptId)?.facts ?? [],
      memory: memory.get(row.conceptId) ?? null,
    });
  }
  return out;
}

/** `review_logs` joined with the variant group keys of their source attempts. */
function loadReviewFacts(orm: Orm, learnerId: string, conceptIds: readonly string[]) {
  const rows = orm
    .select()
    .from(reviewLogs)
    .where(and(eq(reviewLogs.learnerId, learnerId), inArray(reviewLogs.conceptId, [...conceptIds])))
    .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
    .all();
  const sources = rows.map((r) => ({
    row: r,
    attemptIds: fromRow(stringListJson, r.sourceAttemptIdsJson, 'review_logs', r.id),
  }));
  const allIds = [...new Set(sources.flatMap((s) => s.attemptIds))];
  const groups = new Map<string, string>();
  if (allIds.length > 0) {
    for (const a of orm
      .select({ id: attempts.id, key: attempts.variantGroupKey })
      .from(attempts)
      .where(inArray(attempts.id, allIds))
      .all()) {
      groups.set(a.id, a.key);
    }
  }
  const out = new Map<string, { facts: ReviewFact[]; lastRating: FsrsRating }>();
  for (const { row, attemptIds } of sources) {
    const entry = out.get(row.conceptId) ?? { facts: [], lastRating: row.rating };
    entry.facts.push({
      reviewedAt: row.reviewedAt.getTime(),
      rating: row.rating,
      variantGroupKeys: [
        ...new Set(attemptIds.map((id) => groups.get(id)).filter((k) => k !== undefined)),
      ],
    });
    out.set(row.conceptId, entry);
  }
  return out;
}

/** Rating of the latest review per concept (`buildReviewQueue` input). */
export function lastRatings(orm: Orm, learnerId: string, conceptIds: readonly string[]) {
  const out = new Map<string, FsrsRating>();
  if (conceptIds.length === 0) return out;
  for (const [id, entry] of loadReviewFacts(orm, learnerId, conceptIds))
    out.set(id, entry.lastRating);
  return out;
}

export function upsertMastery(orm: Orm, learnerId: string, update: MasteryUpdate, now: number) {
  const a = update.after;
  const values = {
    score: a.score,
    stage: a.stage,
    evidenceWeightSum: a.evidenceWeightSum,
    distinctTypesCorrectJson: forWrite(
      stringListJson,
      a.distinctTypesCorrect,
      'concept_mastery.distinct_types_correct_json',
    ),
    maxDifficultyCorrect: a.maxDifficultyCorrect,
    consecutiveFailures: a.consecutiveFailures,
    lastAttemptAt: a.lastAttemptAt === null ? null : new Date(a.lastAttemptAt),
    stageChangedAt: a.stageChangedAt === null ? null : new Date(a.stageChangedAt),
    updatedAt: new Date(now),
    engineVersion: update.engineVersion,
  };
  orm
    .insert(conceptMastery)
    .values({ learnerId, conceptId: update.conceptId, ...values })
    .onConflictDoUpdate({
      target: [conceptMastery.learnerId, conceptMastery.conceptId],
      set: values,
    })
    .run();
}

export function insertEvidence(orm: Orm, learnerId: string, record: MasteryEvidenceRecord) {
  orm
    .insert(masteryEvidence)
    .values({
      id: newId(),
      learnerId,
      conceptId: record.conceptId,
      attemptId: record.attemptId,
      kind: record.kind,
      scoreBefore: record.scoreBefore,
      scoreAfter: record.scoreAfter,
      stageBefore: record.stageBefore,
      stageAfter: record.stageAfter,
      breakdownJson: forWrite(breakdownJson, record.breakdown, 'mastery_evidence.breakdown_json'),
      createdAt: new Date(record.createdAt),
    })
    .run();
}

export function upsertMemory(orm: Orm, learnerId: string, memory: ConceptMemoryState, now: number) {
  const { card } = memory;
  const values = {
    cardJson: forWrite(cardJson, card.raw, 'concept_memory.card_json'),
    fsrsVersion: memory.fsrsVersion,
    state: card.state,
    dueAt: new Date(card.dueAt),
    stability: card.stability,
    difficulty: card.difficulty,
    lastReviewAt: card.lastReviewAt === null ? null : new Date(card.lastReviewAt),
    reps: card.reps,
    lapses: card.lapses,
    suspended: memory.suspended,
    updatedAt: new Date(now),
  };
  orm
    .insert(conceptMemory)
    .values({ learnerId, conceptId: memory.conceptId, ...values })
    .onConflictDoUpdate({ target: [conceptMemory.learnerId, conceptMemory.conceptId], set: values })
    .run();
}

export function insertReviewLog(orm: Orm, learnerId: string, record: ReviewLogRecord) {
  orm
    .insert(reviewLogs)
    .values({
      id: newId(),
      learnerId,
      conceptId: record.conceptId,
      rating: record.rating,
      sourceAttemptIdsJson: forWrite(
        stringListJson,
        record.sourceAttemptIds,
        'review_logs.source_attempt_ids_json',
      ),
      reviewedAt: new Date(record.reviewedAt),
      elapsedDays: record.elapsedDays,
      scheduledDays: record.scheduledDays,
      stateBefore: record.stateBefore,
      revlogJson: forWrite(revlogJson, record.revlog, 'review_logs.revlog_json'),
      retrievabilityBefore: record.retrievabilityBefore,
    })
    .run();
}

/** Newest `mastery_evidence` rows of a concept with the total count (concept detail). */
export function listEvidence(orm: Orm, learnerId: string, conceptId: string, limit: number) {
  const where = and(
    eq(masteryEvidence.learnerId, learnerId),
    eq(masteryEvidence.conceptId, conceptId),
  );
  const rows = orm
    .select()
    .from(masteryEvidence)
    .where(where)
    .orderBy(desc(masteryEvidence.createdAt), desc(masteryEvidence.id))
    .limit(limit)
    .all()
    .map((row) => ({
      ...row,
      breakdown: fromRow(breakdownJson, row.breakdownJson, 'mastery_evidence', row.id),
    }));
  const total = orm.select({ n: count() }).from(masteryEvidence).where(where).get()?.n ?? 0;
  return { rows, total };
}

/** Newest FSRS reviews of a concept. */
export function recentReviews(orm: Orm, learnerId: string, conceptId: string, limit: number) {
  return orm
    .select({ reviewedAt: reviewLogs.reviewedAt, rating: reviewLogs.rating })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.learnerId, learnerId), eq(reviewLogs.conceptId, conceptId)))
    .orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
    .limit(limit)
    .all()
    .map((r) => ({ reviewedAt: r.reviewedAt.getTime(), rating: r.rating }));
}

/** Every concept the learner has a `concept_mastery` row for. */
export function listMasteryConceptIds(orm: Orm, learnerId: string): string[] {
  return orm
    .select({ conceptId: conceptMastery.conceptId })
    .from(conceptMastery)
    .where(eq(conceptMastery.learnerId, learnerId))
    .orderBy(asc(conceptMastery.conceptId))
    .all()
    .map((r) => r.conceptId);
}

/** Concepts with an FSRS card due before `before` (end of the learner's day), not suspended. */
export function dueConceptIds(orm: Orm, learnerId: string, before: number): string[] {
  return orm
    .select({ conceptId: conceptMemory.conceptId })
    .from(conceptMemory)
    .where(
      and(
        eq(conceptMemory.learnerId, learnerId),
        eq(conceptMemory.suspended, false),
        lt(conceptMemory.dueAt, new Date(before)),
      ),
    )
    .orderBy(asc(conceptMemory.dueAt))
    .all()
    .map((r) => r.conceptId);
}
