import type {
  MisconceptionState,
  MisconceptionUpdate,
  RemediationHistoryEntry,
  RemediationSuggestion,
} from '@proginone/learning-engine';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Orm } from './connection.ts';
import { remediationDetailJson, stringListJson } from './json.ts';
import { forWrite, fromRow } from './json-io.ts';
import { newId } from './learners.ts';
import { attempts, misconceptionObservations, remediationSuggestions } from './schema.ts';

// misconception_observations and remediation_suggestions. Reads assemble the engine's
// `MisconceptionState` / `RemediationHistoryEntry`; writes take engine outputs.

export type ObservationRow = typeof misconceptionObservations.$inferSelect;
export type RemediationRow = typeof remediationSuggestions.$inferSelect;

/** An engine state together with its row id and the stored AI description. */
export interface StoredObservation {
  rowId: string;
  state: MisconceptionState;
  aiDescription: string | null;
}

function toStates(orm: Orm, rows: ObservationRow[]): StoredObservation[] {
  const lists = rows.map((row) => ({
    row,
    evidence: fromRow(
      stringListJson,
      row.evidenceAttemptIdsJson,
      'misconception_observations',
      row.id,
    ),
    resolution: fromRow(
      stringListJson,
      row.resolutionAttemptIdsJson,
      'misconception_observations',
      row.id,
    ),
  }));
  const ids = [...new Set(lists.flatMap((l) => [...l.evidence, ...l.resolution]))];
  const facts = new Map<string, { exerciseId: string; at: number }>();
  if (ids.length > 0) {
    for (const a of orm
      .select({ id: attempts.id, exerciseId: attempts.exerciseId, at: attempts.submittedAt })
      .from(attempts)
      .where(inArray(attempts.id, ids))
      .all()) {
      facts.set(a.id, { exerciseId: a.exerciseId, at: a.at.getTime() });
    }
  }
  return lists.map(({ row, evidence, resolution }) => ({
    rowId: row.id,
    aiDescription: row.aiDescription,
    state: {
      misconceptionId: row.misconceptionId,
      conceptId: row.conceptId,
      status: row.status,
      source: row.source,
      // Per-evidence sources are not stored: the first evidence has the row's source and later
      // evidence comes from attempts (only "AI or not" matters to the transitions).
      evidence: evidence.map((attemptId, i) => ({
        attemptId,
        exerciseId: facts.get(attemptId)?.exerciseId ?? '',
        at: facts.get(attemptId)?.at ?? row.firstSeenAt.getTime(),
        source: i === 0 ? row.source : row.source === 'ai' ? 'pattern' : row.source,
      })),
      resolution: resolution.map((attemptId) => ({
        attemptId,
        at: facts.get(attemptId)?.at ?? row.lastSeenAt.getTime(),
      })),
      confirmCount: row.confirmCount,
      firstSeenAt: row.firstSeenAt.getTime(),
      lastSeenAt: row.lastSeenAt.getTime(),
      resolvedAt: row.resolvedAt?.getTime() ?? null,
    },
  }));
}

/**
 * The current observation of each misconception: the active row if any, else the most recently
 * seen closed row (reopened in place by the next evidence).
 */
export function loadObservations(
  orm: Orm,
  learnerId: string,
  misconceptionIds: readonly string[],
): Map<string, StoredObservation> {
  const out = new Map<string, StoredObservation>();
  if (misconceptionIds.length === 0) return out;
  const rows = orm
    .select()
    .from(misconceptionObservations)
    .where(
      and(
        eq(misconceptionObservations.learnerId, learnerId),
        inArray(misconceptionObservations.misconceptionId, [...new Set(misconceptionIds)]),
      ),
    )
    .orderBy(asc(misconceptionObservations.lastSeenAt), asc(misconceptionObservations.id))
    .all();
  for (const stored of toStates(orm, rows)) {
    const current = out.get(stored.state.misconceptionId);
    const active = (s: StoredObservation) =>
      s.state.status === 'suspected' || s.state.status === 'confirmed';
    if (!current || active(stored) || !active(current))
      out.set(stored.state.misconceptionId, stored);
  }
  return out;
}

/** Every observation of the given concepts (all statuses), newest first. */
export function listObservationsForConcepts(
  orm: Orm,
  learnerId: string,
  conceptIds: readonly string[],
): StoredObservation[] {
  if (conceptIds.length === 0) return [];
  const rows = orm
    .select()
    .from(misconceptionObservations)
    .where(
      and(
        eq(misconceptionObservations.learnerId, learnerId),
        inArray(misconceptionObservations.conceptId, [...new Set(conceptIds)]),
      ),
    )
    .orderBy(desc(misconceptionObservations.lastSeenAt), desc(misconceptionObservations.id))
    .all();
  return toStates(orm, rows);
}

/** Every observation of the learner (weakness ranking, review priority, set selection). */
export function listAllObservations(orm: Orm, learnerId: string): StoredObservation[] {
  const rows = orm
    .select()
    .from(misconceptionObservations)
    .where(eq(misconceptionObservations.learnerId, learnerId))
    .orderBy(desc(misconceptionObservations.lastSeenAt), desc(misconceptionObservations.id))
    .all();
  return toStates(orm, rows);
}

/** Inserts (`rowId === null`) or updates an observation from an engine update. */
export function writeObservation(
  orm: Orm,
  learnerId: string,
  rowId: string | null,
  update: MisconceptionUpdate,
  /** Required for a new unclassified AI candidate (`ai.<ULID>`). */
  aiDescription?: string,
): void {
  const a = update.after;
  const values = {
    conceptId: a.conceptId,
    status: a.status,
    source: a.source,
    evidenceAttemptIdsJson: forWrite(
      stringListJson.min(1),
      a.evidence.map((e) => e.attemptId),
      'misconception_observations.evidence_attempt_ids_json',
    ),
    resolutionAttemptIdsJson: forWrite(
      stringListJson,
      a.resolution.map((r) => r.attemptId),
      'misconception_observations.resolution_attempt_ids_json',
    ),
    confirmCount: a.confirmCount,
    firstSeenAt: new Date(a.firstSeenAt),
    lastSeenAt: new Date(a.lastSeenAt),
    resolvedAt: a.resolvedAt === null ? null : new Date(a.resolvedAt),
  };
  if (rowId === null) {
    orm
      .insert(misconceptionObservations)
      .values({
        id: newId(),
        learnerId,
        misconceptionId: a.misconceptionId,
        ...values,
        ...(aiDescription === undefined ? {} : { aiDescription }),
      })
      .run();
  } else {
    orm
      .update(misconceptionObservations)
      .set(values)
      .where(eq(misconceptionObservations.id, rowId))
      .run();
  }
}

/** Suggestions of a concept since `since` (engine escalation history), oldest first. */
export function recentRemediations(
  orm: Orm,
  learnerId: string,
  conceptId: string,
  since: number,
): (RemediationHistoryEntry & { id: string; practiceSetId: string | null; itemIds: string[] })[] {
  return orm
    .select()
    .from(remediationSuggestions)
    .where(
      and(
        eq(remediationSuggestions.learnerId, learnerId),
        eq(remediationSuggestions.conceptId, conceptId),
        gte(remediationSuggestions.createdAt, new Date(since)),
      ),
    )
    .orderBy(asc(remediationSuggestions.createdAt), asc(remediationSuggestions.id))
    .all()
    .map((row) => ({
      id: row.id,
      practiceSetId: row.practiceSetId,
      itemIds: fromRow(stringListJson, row.itemIdsJson, 'remediation_suggestions', row.id),
      conceptId: row.conceptId,
      kind: row.kind,
      prerequisiteId: row.prerequisiteId,
      workedExampleStage: row.workedExampleStage,
      at: row.createdAt.getTime(),
    }));
}

export function insertRemediation(
  orm: Orm,
  row: {
    id: string;
    learnerId: string;
    practiceSetId: string | null;
    attemptId: string;
    suggestion: RemediationSuggestion;
    itemIds: readonly string[];
    createdAt: number;
  },
): void {
  const s = row.suggestion;
  orm
    .insert(remediationSuggestions)
    .values({
      id: row.id,
      learnerId: row.learnerId,
      conceptId: s.conceptId,
      practiceSetId: row.practiceSetId,
      attemptId: row.attemptId,
      trigger: s.trigger,
      kind: s.kind,
      prerequisiteId: s.prerequisite?.conceptId ?? null,
      workedExampleStage:
        s.workedExamples.length === 0 ? null : Math.max(...s.workedExamples.map((w) => w.stage)),
      detailJson: forWrite(remediationDetailJson, s, 'remediation_suggestions.detail_json'),
      itemIdsJson: forWrite(stringListJson, row.itemIds, 'remediation_suggestions.item_ids_json'),
      createdAt: new Date(row.createdAt),
    })
    .run();
}
