import { createHash } from 'node:crypto';
import {
  exerciseOriginOf,
  gradeSubmission,
  parseAnswer,
  redactSpec,
  type GradeResult,
} from '@proginone/exercise-kit';
import {
  applyAttempt,
  conceptsReadyToFlush,
  evaluateAssessment,
  isUnassisted,
  nextAdaptiveStep,
  REMEDIAL_REASONS,
  type AttemptEffects,
  type ItemOutcome,
  evaluatePassRule,
  flushPendingRatings,
  initialConceptState,
  localDateOf,
  observationOf,
  type AttemptFacts,
  type ConceptState,
  type DayBoundary,
  type EngineDeps,
  type ExerciseCandidate,
  type FlushResult,
  type HintLevel,
  type MisconceptionUpdate,
  type MasteryEvidenceRecord,
  type MasteryUpdate,
  type PassResult,
  type PassRuleItem,
  type PendingRating,
  type RemediationSuggestion,
} from '@proginone/learning-engine';
import {
  parseRunResult,
  type AttemptRequest,
  type AttemptResponse,
  type SubmitAttemptResponse,
  type InlineAttemptRequest,
  type InlineAttemptResponse,
  type RunResult,
  type SetAdaptation,
  type SkipItemResponse,
} from '@proginone/shared';
import type { ContentExercise, ContentRepository } from '../../db/content/repository.ts';
import {
  countAppliedItemAttempts,
  countAppliedStandaloneAttempts,
  countExerciseAttempts,
  insertAttempt,
  insertSnapshot,
  insertSubmission,
} from '../../db/user/attempts.ts';
import type { UserDb } from '../../db/user/connection.ts';
import {
  excludedExerciseIds,
  findItem,
  hintState,
  listHintEvents,
} from '../../db/user/exercise-records.ts';
import {
  RUN_CONSOLE_KEEP,
  RUN_RESULT_MAX_BYTES,
  type GradingJson,
  type PracticeResultJson,
  type RunResultJson,
} from '../../db/user/json.ts';
import { newId } from '../../db/user/learners.ts';
import {
  insertRemediation,
  writeObservation,
  type StoredObservation,
} from '../../db/user/misconceptions.ts';
import {
  insertEvidence,
  insertReviewLog,
  loadConceptStates,
  upsertMastery,
  upsertMemory,
} from '../../db/user/learning-state.ts';
import {
  appliedItemAttempts,
  completeSet,
  getSet,
  inActiveAssessment,
  insertItems,
  insertPendingRating,
  lastSeenAtByGroup,
  seenExerciseIds,
  listItems,
  replaceItemExercise,
  touchedItemIds,
  listUnflushedRatings,
  markRatingsFlushed,
  updateItem,
  type PracticeItemRow,
  type PracticeSet,
} from '../../db/user/practice-sets.ts';
import {
  addDailyActivity,
  getLessonProgress,
  upsertLessonProgress,
} from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { candidateOf, learnerContext } from './engine.ts';
import { itemRows } from './practice-set-service.ts';
import { kit, loadSpec } from './kit.ts';
import {
  misconceptionChanges,
  misconceptionInput,
  remediationContext,
  remediationView,
} from './signals.ts';
import { templateCandidates } from './templates.ts';
import { nextItemIdOf, progressOf, resultView } from './views.ts';

export interface AttemptServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  engine: EngineDeps;
  now: Clock;
}

/** A pending rating with its row id (`isNew`: created by this attempt). */
type Pending = PendingRating & { id: string; isNew: boolean };

/** Everything the engine decided for one attempt, computed before the transaction. */
interface EnginePlan {
  items: PracticeItemRow[];
  setFinished: boolean;
  /** Per concept: state before this attempt → final state (attempt + any FSRS review). */
  mastery: MasteryUpdate[];
  evidence: MasteryEvidenceRecord[];
  pending: Pending[];
  flush: FlushResult;
  /** Pending row ids applied / skipped by the flush. */
  appliedIds: string[];
  skippedIds: string[];
  /** Concepts whose ratings were applied or skipped by this attempt's flush. */
  conceptsFlushed: number;
  result: PracticeResultJson | null;
  lessonCompletedNow: boolean;
  misconceptions: Signals;
  remediation: { id: string; suggestion: RemediationSuggestion; itemIds: string[] } | null;
  /** Pending items whose exercise was replaced (`difficulty_step_up`). */
  replaced: PracticeItemRow[];
  /** Items appended to the set (relearning, follow-ups). */
  appended: PracticeItemRow[];
}

/** Misconception updates with the stored rows they apply to. */
export interface Signals {
  updates: readonly MisconceptionUpdate[];
  stored: Map<string, StoredObservation>;
}

const EMPTY_EFFECTS: AttemptEffects = {
  mastery: [],
  evidence: [],
  pendingRatings: [],
  misconceptions: [],
  remediation: null,
};

const isRemedial = (reason: string) => (REMEDIAL_REASONS as readonly string[]).includes(reason);

const EMPTY_FLUSH: FlushResult = {
  memory: [],
  reviewLogs: [],
  skipped: [],
  mastery: [],
  evidence: [],
};

/**
 * `POST /attempts` (docs/design/system-architecture.md#문제-제출-흐름-코드-실습): validate →
 * grade with the server spec → engine (pure, before the transaction) → one transaction with
 * every write. Sandbox failures (`crashed`/`aborted`) are stored with `engine_applied = 0` and
 * never reach the engine; the item stays pending.
 */
export class AttemptService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: AttemptServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  submit(request: AttemptRequest): SubmitAttemptResponse {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);

    // 1. Validate the context.
    const found = findItem(orm, learnerId, request.practiceSetItemId);
    const set = found && getSet(orm, learnerId, found.item.practiceSetId);
    if (!found || !set) {
      throw new AppError('NOT_FOUND', 404, '연습 항목을 찾을 수 없습니다.', {
        details: { practiceSetItemId: request.practiceSetItemId },
      });
    }
    const item = found.item;
    if (item.exerciseId !== request.exerciseId) {
      throw new AppError('PRACTICE_ITEM_MISMATCH', 400, '이 연습 항목의 문제가 아닙니다.', {
        details: { expected: item.exerciseId, received: request.exerciseId },
      });
    }
    if (set.row.status !== 'active') {
      throw new AppError('PRACTICE_SET_CLOSED', 409, '이미 끝난 연습 세트입니다.', {
        details: { practiceSetId: set.row.id },
      });
    }
    // Assessments take one submission per item (learning-engine.md#단원-평가-세트).
    if (set.row.kind === 'assessment' && item.status !== 'pending') {
      throw new AppError(
        'PRACTICE_ITEM_DONE',
        409,
        '단원 평가의 문항은 한 번만 제출할 수 있습니다.',
        { details: { itemId: item.id, status: item.status } },
      );
    }
    const exercise = repo.getExercise(item.exerciseId);
    if (!exercise) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', {
        details: { id: item.exerciseId },
      });
    }
    const candidate = candidateOf(exercise);
    if (!candidate) {
      throw new AppError('EXERCISE_UNSUPPORTED', 500, '이 문제는 채점할 수 없습니다.', {
        details: { id: exercise.id },
      });
    }

    // 2. Grade with the server-side spec. The run result is untrusted: parse it first.
    const { def, spec } = loadSpec(exercise);
    const answer = kit(() => parseAnswer(exercise.type, request.answer));
    let run: RunResult | null = null;
    if (def.requiresRun(spec) && request.runResult !== undefined) {
      const parsed = parseRunResult(request.runResult);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_RUN_RESULT_INVALID',
          400,
          '실행 결과 형식이 올바르지 않습니다.',
          { details: { issues: [parsed.error.slice(0, 500)] } },
        );
      }
      run = parsed.data;
    }
    const grade = kit(() =>
      gradeSubmission({ typeId: exercise.type, spec, answer, ...(run ? { run } : {}) }),
    );
    const misconceptions = repo.getMisconceptions(grade.misconceptionIds);

    // 3. Attempt facts.
    const hints = hintState(
      listHintEvents(orm, { learnerId, exerciseId: exercise.id, itemId: item.id }),
    );
    const attemptId = newId();
    const attemptNo = countExerciseAttempts(orm, learnerId, exercise.id) + 1;
    const attemptInItem = countAppliedItemAttempts(orm, item.id) + 1;
    const startedAt = Math.min(request.startedAt, now);
    const activeMs = Math.min(request.activeMs, now - startedAt);
    const engineApplied = grade.engineApplicable;
    const facts: AttemptFacts = {
      attemptId,
      outcome: grade.outcome,
      score: grade.score,
      confidence: request.confidence ?? null,
      hintLevelMax: Math.min(3, hints.level) as HintLevel,
      solutionViewed: hints.solutionViewed,
      tutorAssisted: request.tutorAssisted ?? false,
      attemptInItem,
      activeMs,
      setKind: set.row.kind,
      misconceptionConceptIds: [...misconceptions.values()].map((m) => m.conceptId),
      submittedAt: now,
    };

    // 4. Engine (pure; before the transaction).
    const plan = engineApplied
      ? this.#plan({
          learnerId,
          set,
          item,
          attempt: { candidate, facts, misconceptionIds: grade.misconceptionIds },
          dayBoundary,
          now,
        })
      : null;

    // 5. One transaction.
    const date = localDateOf(now, dayBoundary);
    orm.transaction(() => {
      insertSnapshot(orm, {
        contentHash: exercise.contentHash,
        exerciseId: exercise.id,
        publicSpec: kit(() => redactSpec(exercise.type, spec, { shuffleSeed: item.id })),
        createdAt: now,
      });
      insertAttempt(orm, {
        id: attemptId,
        learnerId,
        exerciseId: exercise.id,
        exerciseOrigin: item.exerciseOrigin,
        variantGroupKey: candidate.variantGroupKey,
        exerciseVersionHash: exercise.contentHash,
        practiceSetItemId: item.id,
        studySessionId: null,
        attemptNo,
        attemptInItem: engineApplied ? attemptInItem : attemptInItem - 1,
        outcome: grade.outcome,
        score: grade.score,
        confidence: facts.confidence,
        hintLevelMax: facts.hintLevelMax,
        solutionViewed: facts.solutionViewed,
        tutorAssisted: facts.tutorAssisted,
        startedAt: new Date(startedAt),
        submittedAt: new Date(now),
        activeMs,
        misconceptionIds: grade.misconceptionIds,
        grading: gradingOf(grade, run),
        isReview: set.row.kind === 'review',
        engineApplied,
      });
      insertSubmission(orm, {
        attemptId,
        learnerId,
        answer,
        runResult: run === null ? null : storedRun(run),
        answerHash: createHash('sha256').update(JSON.stringify(answer)).digest('hex'),
      });
      if (plan) {
        this.#write(plan, { learnerId, set, item, attemptId, correct: grade.correct, date, now });
      }
    });

    const outcome = { set, item, exercise, grade, plan, attemptId, attemptNo, attemptInItem };
    return set.row.kind === 'assessment' ? this.#withheld(outcome) : this.#response(outcome);
  }

  /**
   * `POST /exercises/:id/inline-attempts`: an inline check answered while reading the lesson
   * (learning-engine.md: `InlineExercise` counts as regular evidence). There is no practice set:
   * the attempt has no item, mastery and evidence are written, and the FSRS ratings the engine
   * proposes are dropped (spaced scheduling comes from practice and review sets, not from a check
   * right after the explanation). Run-based exercises are not inline checks.
   */
  submitInline(exerciseId: string, request: InlineAttemptRequest): InlineAttemptResponse {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const exercise = repo.getExercise(exerciseId);
    if (!exercise) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', {
        details: { id: exerciseId },
      });
    }
    // Assessment items are graded only inside their assessment; an inline attempt would reveal
    // the result and the explanation (learning-engine.md#단원-평가-세트).
    if (exercise.usage === 'assessment' || inActiveAssessment(orm, learnerId, exercise.id)) {
      throw new AppError(
        'EXERCISE_LOCKED_IN_ASSESSMENT',
        403,
        '단원 평가 문항은 평가 안에서만 풀 수 있습니다.',
        { details: { exerciseId: exercise.id } },
      );
    }
    const candidate = candidateOf(exercise);
    if (!candidate) {
      throw new AppError('EXERCISE_UNSUPPORTED', 500, '이 문제는 채점할 수 없습니다.', {
        details: { id: exercise.id },
      });
    }
    const { def, spec } = loadSpec(exercise);
    if (def.requiresRun(spec)) {
      throw new AppError(
        'EXERCISE_RUN_REQUIRED',
        409,
        '코드를 실행해야 채점할 수 있는 문제는 본문 확인 문제로 풀 수 없습니다.',
        { details: { type: exercise.type } },
      );
    }
    const answer = kit(() => parseAnswer(exercise.type, request.answer));
    const grade = kit(() => gradeSubmission({ typeId: exercise.type, spec, answer }));
    const misconceptions = repo.getMisconceptions(grade.misconceptionIds);

    const hints = hintState(listHintEvents(orm, { learnerId, exerciseId, itemId: null }));
    const attemptId = newId();
    const attemptNo = countExerciseAttempts(orm, learnerId, exerciseId) + 1;
    const attemptInItem = countAppliedStandaloneAttempts(orm, learnerId, exerciseId) + 1;
    const startedAt = Math.min(request.startedAt, now);
    const activeMs = Math.min(request.activeMs, now - startedAt);
    const facts: AttemptFacts = {
      attemptId,
      outcome: grade.outcome,
      score: grade.score,
      confidence: request.confidence ?? null,
      hintLevelMax: Math.min(3, hints.level) as HintLevel,
      solutionViewed: hints.solutionViewed,
      tutorAssisted: request.tutorAssisted ?? false,
      attemptInItem,
      activeMs,
      setKind: null,
      misconceptionConceptIds: [...misconceptions.values()].map((m) => m.conceptId),
      submittedAt: now,
    };
    const engineApplied = grade.engineApplicable;
    const mc = engineApplied
      ? misconceptionInput(repo, orm, learnerId, candidate, grade.misconceptionIds)
      : null;
    const effects = engineApplied
      ? applyAttempt(this.#engine, {
          attempt: facts,
          exercise: candidate,
          concepts: [
            ...loadConceptStates(
              orm,
              learnerId,
              candidate.concepts.map((c) => c.conceptId),
              this.#engine.fsrs,
            ).values(),
          ],
          now,
          dayBoundary,
          ...(mc ? { misconceptions: mc.input } : {}),
        })
      : null;

    orm.transaction(() => {
      insertSnapshot(orm, {
        contentHash: exercise.contentHash,
        exerciseId: exercise.id,
        publicSpec: kit(() => redactSpec(exercise.type, spec, { shuffleSeed: exercise.id })),
        createdAt: now,
      });
      insertAttempt(orm, {
        id: attemptId,
        learnerId,
        exerciseId: exercise.id,
        exerciseOrigin: exerciseOriginOf(exercise.id) ?? exercise.origin,
        variantGroupKey: candidate.variantGroupKey,
        exerciseVersionHash: exercise.contentHash,
        practiceSetItemId: null,
        studySessionId: null,
        attemptNo,
        attemptInItem: engineApplied ? attemptInItem : attemptInItem - 1,
        outcome: grade.outcome,
        score: grade.score,
        confidence: facts.confidence,
        hintLevelMax: facts.hintLevelMax,
        solutionViewed: facts.solutionViewed,
        tutorAssisted: facts.tutorAssisted,
        startedAt: new Date(startedAt),
        submittedAt: new Date(now),
        activeMs,
        misconceptionIds: grade.misconceptionIds,
        grading: gradingOf(grade, null),
        isReview: false,
        engineApplied,
      });
      insertSubmission(orm, {
        attemptId,
        learnerId,
        answer,
        runResult: null,
        answerHash: createHash('sha256').update(JSON.stringify(answer)).digest('hex'),
      });
      if (effects) {
        for (const update of effects.mastery) upsertMastery(orm, learnerId, update, now);
        for (const record of effects.evidence) insertEvidence(orm, learnerId, record);
        if (mc)
          writeSignals(orm, learnerId, { updates: effects.misconceptions, stored: mc.stored });
      }
      addDailyActivity(orm, learnerId, localDateOf(now, dayBoundary), {
        attempts: 1,
        correct: grade.correct ? 1 : 0,
        lessonsCompleted: 0,
        reviewsDone: 0,
      });
    });

    const titles = repo.getConcepts(effects?.mastery.map((m) => m.conceptId) ?? []);
    return {
      attempt: {
        id: attemptId,
        outcome: grade.outcome,
        score: grade.score,
        correct: grade.correct,
        engineApplied,
        attemptNo,
        attemptInItem: engineApplied ? attemptInItem : attemptInItem - 1,
      },
      grade: {
        feedback: grade.feedback,
        ...(grade.checkResults ? { checkResults: grade.checkResults } : {}),
        misconceptions: grade.misconceptionIds.map((id) => ({
          id,
          title: misconceptions.get(id)?.title ?? id,
        })),
        explanation: exercise.explanation,
      },
      masteryChanges: (effects?.mastery ?? []).map((m) => ({
        conceptId: m.conceptId,
        title: titles.get(m.conceptId)?.title ?? m.conceptId,
        scoreBefore: m.before.score,
        scoreAfter: m.after.score,
        stageBefore: m.before.stage,
        stageAfter: m.after.stage,
      })),
      misconceptionChanges: misconceptionChanges(this.#engine, repo, effects?.misconceptions ?? []),
    };
  }

  /**
   * `POST /practice-sets/:id/items/:itemId/skip`: marks a pending item skipped, appends a
   * follow-up (learning-engine.md#진행-중-적응-nextadaptivestep) and, when it was the last pending
   * item, completes the set like a final attempt would (FSRS flush, pass rule, lesson progress).
   */
  skip(setId: string, itemId: string): SkipItemResponse {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);
    const set = getSet(orm, learnerId, setId);
    const item = set ? listItems(orm, set.row.id).find((i) => i.id === itemId) : undefined;
    if (!set || !item) {
      throw new AppError('NOT_FOUND', 404, '연습 항목을 찾을 수 없습니다.', {
        details: { practiceSetId: setId, itemId },
      });
    }
    if (set.row.status !== 'active') {
      throw new AppError('PRACTICE_SET_CLOSED', 409, '이미 끝난 연습 세트입니다.', {
        details: { practiceSetId: set.row.id },
      });
    }
    if (item.status !== 'pending') {
      throw new AppError('PRACTICE_ITEM_DONE', 409, '이미 답했거나 건너뛴 문항입니다.', {
        details: { itemId, status: item.status },
      });
    }
    const plan = this.#plan({ learnerId, set, item, attempt: null, dayBoundary, now });
    const date = localDateOf(now, dayBoundary);
    orm.transaction(() => {
      this.#write(plan, { learnerId, set, item, attemptId: null, correct: false, date, now });
    });
    const repo = this.#content.repo;
    const titles = repo.getConcepts(plan.mastery.map((m) => m.conceptId));
    return {
      item: { id: item.id, status: 'skipped', attempts: 0 },
      adaptations: adaptationsOf(repo, plan),
      masteryChanges: plan.mastery.map((m) => ({
        conceptId: m.conceptId,
        title: titles.get(m.conceptId)?.title ?? m.conceptId,
        scoreBefore: m.before.score,
        scoreAfter: m.after.score,
        stageBefore: m.before.stage,
        stageAfter: m.after.stage,
      })),
      set: {
        id: set.row.id,
        status: plan.setFinished ? 'completed' : set.row.status,
        progress: progressOf(plan.items),
        nextItemId: plan.setFinished ? null : nextItemIdOf(plan.items),
        result: plan.result ? resultView(plan.result, repo, { orm, setId: set.row.id }) : null,
      },
    };
  }

  /**
   * Everything the engine decides for an answered (`attempt` given) or skipped item: mastery,
   * misconceptions, relearning, adaptive items, FSRS flushes and the set result. Reads and pure
   * engine calls only; the caller writes the plan in one transaction.
   */
  #plan(input: {
    learnerId: string;
    set: PracticeSet;
    item: PracticeItemRow;
    attempt: {
      candidate: ExerciseCandidate;
      facts: AttemptFacts;
      misconceptionIds: readonly string[];
    } | null;
    dayBoundary: DayBoundary;
    now: number;
  }): EnginePlan {
    const { learnerId, set, item, dayBoundary, now } = input;
    const candidate = input.attempt?.candidate ?? null;
    const facts = input.attempt?.facts ?? null;
    const repo = this.#content.repo;
    const engine = this.#engine;
    const orm = this.#userDb.orm;
    let items = listItems(orm, set.row.id).map((i) =>
      i.id !== item.id
        ? i
        : facts
          ? { ...i, status: 'answered' as const, finalAttemptId: facts.attemptId }
          : { ...i, status: 'skipped' as const },
    );
    const stored: Pending[] = listUnflushedRatings(orm, set.row.id).map((r) => ({
      id: r.id,
      conceptId: r.conceptId,
      rating: r.rating,
      attemptId: r.attemptId,
      variantGroupKey: r.variantGroupKey,
      at: r.ratedAt.getTime(),
      isNew: false,
    }));
    const conceptIds = [
      ...(candidate?.concepts.map((c) => c.conceptId) ?? []),
      ...(item.targetConceptId === null ? [] : [item.targetConceptId]),
      ...stored.map((p) => p.conceptId),
      ...set.scope.conceptIds,
    ];
    const states = loadConceptStates(orm, learnerId, conceptIds, engine.fsrs);

    const mc =
      candidate && input.attempt
        ? misconceptionInput(repo, orm, learnerId, candidate, input.attempt.misconceptionIds)
        : { input: undefined, stored: new Map<string, StoredObservation>() };
    const primary = candidate?.concepts.find((c) => c.isPrimary)?.conceptId;
    const effects: AttemptEffects =
      candidate && facts
        ? applyAttempt(engine, {
            attempt: facts,
            exercise: candidate,
            concepts: [...states.values()],
            now,
            dayBoundary,
            ...(mc.input ? { misconceptions: mc.input } : {}),
            ...(primary === undefined
              ? {}
              : {
                  remediation: remediationContext(repo, orm, engine, {
                    learnerId,
                    conceptId: primary,
                    setId: set.row.id,
                    items,
                    currentItemId: item.id,
                    now,
                  }),
                }),
          })
        : EMPTY_EFFECTS;

    // Adaptive changes (pure), applied to the in-memory item list before the set is judged.
    const adaptation = this.#adapt({
      learnerId,
      set,
      item,
      items,
      facts,
      remediation: effects.remediation,
      states,
      now,
    });
    items = adaptation.items;
    const remaining = items.filter((i) => i.status === 'pending');
    const setFinished = remaining.length === 0;
    const after = new Map<string, ConceptState>(states);
    for (const update of effects.mastery) {
      const prev = after.get(update.conceptId) ?? initialConceptState(update.conceptId);
      const record = effects.evidence.find(
        (e) => e.conceptId === update.conceptId && e.kind === 'attempt',
      );
      const fact = record && 'fact' in record.breakdown ? record.breakdown.fact : undefined;
      after.set(update.conceptId, {
        ...prev,
        mastery: update.after,
        history: fact ? [...prev.history, fact] : prev.history,
      });
    }

    // FSRS: merge and apply the ratings of concepts whose items are all done.
    const pending: Pending[] = [
      ...stored,
      ...effects.pendingRatings.map((p) => ({ ...p, id: newId(), isNew: true })),
    ];
    const ready = new Set(
      conceptsReadyToFlush({
        pending,
        remainingItemConcepts: remaining.flatMap((i) =>
          i.targetConceptId === null ? [] : [i.targetConceptId],
        ),
        setFinished,
      }),
    );
    const toFlush = pending.filter((p) => ready.has(p.conceptId));
    const flush =
      toFlush.length === 0
        ? EMPTY_FLUSH
        : flushPendingRatings(engine, {
            pending: toFlush,
            concepts: [...ready].flatMap((id) => {
              const state = after.get(id);
              return state ? [state] : [];
            }),
            now,
            dayBoundary,
          });
    const skippedConcepts = new Set(flush.skipped.map((s) => s.conceptId));
    const appliedConcepts = new Set(flush.reviewLogs.map((l) => l.conceptId));

    // Keep the first `before` and the last `after` per concept.
    const finalMastery = new Map<string, MasteryUpdate>();
    for (const update of [...effects.mastery, ...flush.mastery]) {
      const first = finalMastery.get(update.conceptId);
      finalMastery.set(update.conceptId, first ? { ...update, before: first.before } : update);
    }
    const scoreOf = (id: string) =>
      finalMastery.get(id)?.after.score ?? after.get(id)?.mastery.score ?? 0;

    let result: PracticeResultJson | null = null;
    let lessonCompletedNow = false;
    if (setFinished) {
      const attempts = [
        ...appliedItemAttempts(
          orm,
          items.map((i) => i.id),
        ),
        ...(facts
          ? [
              {
                id: facts.attemptId,
                itemId: item.id,
                outcome: facts.outcome,
                score: facts.score,
                hintLevelMax: facts.hintLevelMax,
                solutionViewed: facts.solutionViewed,
                tutorAssisted: facts.tutorAssisted,
                attemptInItem: facts.attemptInItem,
              },
            ]
          : []),
      ];
      const exercises = new Map(
        this.#content.repo.getExercises(items.map((i) => i.exerciseId)).map((e) => [e.id, e]),
      );
      // Relearning items practise scaffolds or other concepts: not part of the lesson's bar.
      const passItems: PassRuleItem[] = items
        .filter((i) => !isRemedial(i.reason))
        .map((i) => {
          const mine = attempts.filter((a) => a.itemId === i.id);
          const last = mine.at(-1);
          const first = mine[0];
          const exercise = exercises.get(i.exerciseId);
          return {
            status: i.status,
            type: exercise?.type ?? 'unknown',
            difficulty: exercise?.difficulty ?? 1,
            finalAttempt:
              i.status === 'answered' && last
                ? {
                    o: observationOf(last),
                    hintLevelMax: Math.min(3, last.hintLevelMax) as HintLevel,
                    solutionViewed: last.solutionViewed,
                    tutorAssisted: last.tutorAssisted,
                    attemptInItem: last.attemptInItem,
                  }
                : null,
            firstAttemptCorrect: first ? observationOf(first) >= 0.5 : false,
          };
        });
      const pass =
        set.row.kind === 'lesson' && set.passRule
          ? evaluatePassRule(
              engine.config,
              {
                minCorrect: set.passRule.minCorrect,
                minConceptScore: set.passRule.minConceptScore,
                minDistinctTypes: set.passRule.minDistinctTypes,
                minLevel3Correct: set.passRule.minLevel3Correct,
              },
              {
                items: passItems,
                introducedScores: Object.fromEntries(
                  set.scope.conceptIds.map((id) => [id, scoreOf(id)]),
                ),
              },
            )
          : null;
      const progress = progressOf(items);
      const lastOutcome = (itemId: string) =>
        attempts.filter((a) => a.itemId === itemId).at(-1)?.outcome;
      const assessment =
        set.row.kind === 'assessment'
          ? evaluateAssessment(engine, {
              passRatio: set.scope.passRatio ?? null,
              items: items.map((i) => ({
                status: i.status,
                conceptId: i.targetConceptId,
                correct: lastOutcome(i.id) === 'correct',
              })),
            })
          : null;
      result = {
        v: 1,
        total: progress.total,
        answered: progress.answered,
        skipped: progress.skipped,
        correct: items.filter((i) => lastOutcome(i.id) === 'correct').length,
        pass: pass === null ? null : toPassJson(pass),
        reviewedConceptIds: [...appliedConcepts].sort(),
        ...(assessment
          ? {
              assessment: {
                correct: assessment.correct,
                total: assessment.total,
                ratio: assessment.ratio,
                passRatio: assessment.passRatio,
                passed: assessment.passed,
                concepts: assessment.concepts.map((c) => ({ ...c })),
                missedConceptIds: [...assessment.missedConceptIds],
              },
            }
          : {}),
      };
      if ((pass?.passed || assessment?.passed) && set.scope.lessonId !== null) {
        const progressRow = getLessonProgress(orm, learnerId, set.scope.lessonId);
        lessonCompletedNow = progressRow?.status !== 'completed';
      }
    }

    return {
      items,
      setFinished,
      mastery: [...finalMastery.values()],
      evidence: [...effects.evidence, ...flush.evidence],
      pending,
      flush,
      appliedIds: toFlush.filter((p) => appliedConcepts.has(p.conceptId)).map((p) => p.id),
      skippedIds: toFlush.filter((p) => skippedConcepts.has(p.conceptId)).map((p) => p.id),
      conceptsFlushed: new Set([...appliedConcepts, ...skippedConcepts]).size,
      result,
      lessonCompletedNow,
      misconceptions: { updates: effects.misconceptions, stored: mc.stored },
      remediation:
        effects.remediation === null
          ? null
          : {
              id: newId(),
              suggestion: effects.remediation,
              itemIds: adaptation.appended.filter((a) => isRemedial(a.reason)).map((a) => a.id),
            },
      replaced: adaptation.replaced,
      appended: adaptation.appended,
    };
  }

  /**
   * `nextAdaptiveStep` for the item just answered or skipped. Candidates are the practice and
   * remedial exercises of the concepts involved (plus worked examples), minus reported ones.
   */
  #adapt(input: {
    learnerId: string;
    set: PracticeSet;
    item: PracticeItemRow;
    items: PracticeItemRow[];
    facts: AttemptFacts | null;
    remediation: RemediationSuggestion | null;
    states: Map<string, ConceptState>;
    now: number;
  }): { items: PracticeItemRow[]; replaced: PracticeItemRow[]; appended: PracticeItemRow[] } {
    const { learnerId, set, item, facts, remediation, now } = input;
    if (set.row.kind === 'assessment') return { items: input.items, replaced: [], appended: [] };
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const conceptIds = [
      ...(item.targetConceptId === null ? [] : [item.targetConceptId]),
      ...(remediation?.prerequisite ? [remediation.prerequisite.conceptId] : []),
    ];
    const excluded = excludedExerciseIds(orm, learnerId);
    const usable = (list: ContentExercise[]) =>
      list
        .filter((e) => !excluded.has(e.id))
        .map(candidateOf)
        .filter((c) => c !== null);
    // Template variants too: a follow-up after viewing the solution is a sibling variant of the
    // same template when there is one (the set's own variants count as served, D-057).
    const candidates = usable([
      ...repo.listExercisesForConcepts(conceptIds, ['practice']),
      ...templateCandidates({
        repo,
        orm,
        learnerId,
        templates: repo.listTemplates({ conceptIds, usages: ['practice'] }),
        seed: `${set.row.id}:${item.id}`,
        excluded,
      }),
    ]);
    const remedialCandidates =
      remediation === null
        ? []
        : usable([
            ...repo.listExercisesForConcepts(conceptIds, ['remedial']),
            ...repo.getExercises(remediation.workedExamples.map((w) => w.exerciseId)),
          ]);
    const itemFacts = new Map(
      repo
        .getExercises(input.items.map((i) => i.exerciseId))
        .map(candidateOf)
        .filter((c) => c !== null)
        .map((c) => [c.id, c]),
    );
    const ids = input.items.map((i) => i.id);
    const touched = touchedItemIds(orm, ids);
    const attempts = appliedItemAttempts(orm, ids);
    const latest = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts) if (a.itemId !== null) latest.set(a.itemId, a);
    const target = new Map(input.items.map((i) => [i.id, i.targetConceptId]));
    const outcomes: ItemOutcome[] = [...latest.entries()]
      .filter(([itemId]) => itemId !== item.id)
      .map(([itemId, a]) => ({
        itemId,
        conceptId: target.get(itemId) ?? null,
        correct: observationOf(a) >= 0.5,
        unassisted: isUnassisted({ ...a, hintLevelMax: Math.min(3, a.hintLevelMax) as HintLevel }),
        at: a.submittedAt.getTime(),
      }))
      .sort((a, b) => a.at - b.at);
    if (facts) {
      outcomes.push({
        itemId: item.id,
        conceptId: item.targetConceptId,
        correct: observationOf(facts) >= 0.5,
        unassisted: isUnassisted(facts),
        at: facts.submittedAt,
      });
    }
    const solutionJustViewed =
      facts !== null &&
      facts.solutionViewed &&
      !attempts.some((a) => a.itemId === item.id && a.solutionViewed);

    const actions = nextAdaptiveStep(this.#engine, {
      set: {
        kind: set.row.kind,
        items: input.items.map((i) => {
          const f = itemFacts.get(i.exerciseId);
          return {
            id: i.id,
            position: i.position,
            exerciseId: i.exerciseId,
            targetConceptId: i.targetConceptId,
            status: i.status,
            reason: i.reason,
            type: f?.type ?? 'unknown',
            difficulty: f?.difficulty ?? 1,
            variantGroupKey: f?.variantGroupKey ?? i.exerciseId,
            touched: touched.has(i.id) || i.id === item.id,
          };
        }),
      },
      itemId: item.id,
      event: facts ? 'answered' : 'skipped',
      outcomes,
      solutionJustViewed,
      remediation,
      candidates,
      remedialCandidates,
      concepts: [...input.states.values()],
      lastSeenAtByGroup: lastSeenAtByGroup(orm, learnerId),
      seenExerciseIds: seenExerciseIds(orm, learnerId),
      seed: `${set.row.id}:${item.id}`,
      now,
    });

    let items = input.items;
    const replaced: PracticeItemRow[] = [];
    const appended: PracticeItemRow[] = [];
    for (const action of actions) {
      if (action.kind === 'replace') {
        items = items.map((i) => {
          if (i.id !== action.itemId) return i;
          const next: PracticeItemRow = {
            ...i,
            exerciseId: action.item.exerciseId,
            exerciseOrigin: action.item.exerciseOrigin,
            reason: action.reason,
          };
          replaced.push(next);
          return next;
        });
      } else {
        for (const row of itemRows(set.row.id, learnerId, [action.item])) {
          appended.push(row);
          items = [...items, row];
        }
      }
    }
    return { items, replaced, appended };
  }

  /** Engine writes; runs inside the attempt transaction. */
  #write(
    plan: EnginePlan,
    ctx: {
      learnerId: string;
      set: PracticeSet;
      item: PracticeItemRow;
      /** `null` when the item was skipped. */
      attemptId: string | null;
      correct: boolean;
      date: string;
      now: number;
    },
  ): void {
    const orm = this.#userDb.orm;
    const { learnerId, set, item, attemptId, correct, date, now } = ctx;
    for (const update of plan.mastery) upsertMastery(orm, learnerId, update, now);
    for (const record of plan.evidence) insertEvidence(orm, learnerId, record);
    writeSignals(orm, learnerId, plan.misconceptions);
    for (const row of plan.replaced) replaceItemExercise(orm, row);
    insertItems(orm, plan.appended);
    if (plan.remediation && attemptId !== null) {
      insertRemediation(orm, {
        id: plan.remediation.id,
        learnerId,
        practiceSetId: set.row.id,
        attemptId,
        suggestion: plan.remediation.suggestion,
        itemIds: plan.remediation.itemIds,
        createdAt: now,
      });
    }
    for (const p of plan.pending.filter((x) => x.isNew)) {
      insertPendingRating(orm, {
        id: p.id,
        learnerId,
        practiceSetId: set.row.id,
        conceptId: p.conceptId,
        rating: p.rating,
        attemptId: p.attemptId,
        variantGroupKey: p.variantGroupKey,
        ratedAt: new Date(p.at),
        flushedAt: null,
        flushOutcome: null,
      });
    }
    markRatingsFlushed(orm, plan.appliedIds, 'applied', now);
    markRatingsFlushed(orm, plan.skippedIds, 'skipped', now);
    for (const memory of plan.flush.memory) upsertMemory(orm, learnerId, memory, now);
    for (const log of plan.flush.reviewLogs) insertReviewLog(orm, learnerId, log);
    updateItem(
      orm,
      item.id,
      attemptId === null
        ? { status: 'skipped', finalAttemptId: item.finalAttemptId }
        : { status: 'answered', finalAttemptId: attemptId },
    );
    if (plan.result) completeSet(orm, set.row.id, plan.result, now);

    const lessonId = set.scope.lessonId;
    if ((set.row.kind === 'lesson' || set.row.kind === 'assessment') && lessonId !== null) {
      const progress = getLessonProgress(orm, learnerId, lessonId);
      const passed = plan.result?.pass?.passed === true || plan.result?.assessment?.passed === true;
      upsertLessonProgress(orm, {
        learnerId,
        lessonId,
        status: passed || progress?.status === 'completed' ? 'completed' : 'practicing',
        lastSectionId: progress?.lastSectionId ?? null,
        readProgress: progress?.readProgress ?? 0,
        practiceSetId: plan.setFinished ? null : (progress?.practiceSetId ?? set.row.id),
        startedAt: progress?.startedAt ?? new Date(now),
        completedAt: progress?.completedAt ?? (passed ? new Date(now) : null),
        contentHashSeen: progress?.contentHashSeen ?? null,
        updatedAt: new Date(now),
      });
    }
    addDailyActivity(orm, learnerId, date, {
      attempts: attemptId === null ? 0 : 1,
      correct: correct ? 1 : 0,
      lessonsCompleted: plan.lessonCompletedNow ? 1 : 0,
      reviewsDone: set.row.kind === 'review' ? plan.conceptsFlushed : 0,
    });
  }

  #response(input: {
    set: PracticeSet;
    item: PracticeItemRow;
    exercise: ContentExercise;
    grade: GradeResult;
    plan: EnginePlan | null;
    attemptId: string;
    attemptNo: number;
    attemptInItem: number;
  }): AttemptResponse {
    const { set, item, grade, plan, attemptId, attemptNo, attemptInItem } = input;
    const repo = this.#content.repo;
    const orm = this.#userDb.orm;
    const titles = repo.getConcepts(plan?.mastery.map((m) => m.conceptId) ?? []);
    const misconceptions = repo.getMisconceptions(grade.misconceptionIds);
    const items = plan?.items ?? listItems(this.#userDb.orm, set.row.id);
    const applied = plan !== null;
    return {
      attempt: {
        id: attemptId,
        outcome: grade.outcome,
        score: grade.score,
        correct: grade.correct,
        engineApplied: applied,
        attemptNo,
        attemptInItem: applied ? attemptInItem : attemptInItem - 1,
      },
      grade: {
        feedback: grade.feedback,
        ...(grade.checkResults ? { checkResults: grade.checkResults } : {}),
        ...(grade.failedRequirements ? { failedRequirements: grade.failedRequirements } : {}),
        ...(grade.milestones ? { milestones: grade.milestones } : {}),
        misconceptions: grade.misconceptionIds.map((id) => ({
          id,
          title: misconceptions.get(id)?.title ?? id,
        })),
        explanation: input.exercise.explanation,
      },
      masteryChanges: (plan?.mastery ?? []).map((m) => ({
        conceptId: m.conceptId,
        title: titles.get(m.conceptId)?.title ?? m.conceptId,
        scoreBefore: m.before.score,
        scoreAfter: m.after.score,
        stageBefore: m.before.stage,
        stageAfter: m.after.stage,
      })),
      misconceptionChanges: misconceptionChanges(
        this.#engine,
        repo,
        plan?.misconceptions.updates ?? [],
      ),
      remediation: plan?.remediation ? remediationView(repo, plan.remediation) : null,
      adaptations: adaptationsOf(repo, plan),
      item: {
        id: item.id,
        status: applied ? 'answered' : item.status,
        attempts: applied ? attemptInItem : attemptInItem - 1,
      },
      set: {
        id: set.row.id,
        status: plan?.setFinished ? 'completed' : set.row.status,
        progress: progressOf(items),
        nextItemId: plan?.setFinished ? null : nextItemIdOf(items),
        result: plan?.result ? resultView(plan.result, repo, { orm, setId: set.row.id }) : null,
      },
    };
  }

  /**
   * The answer of an assessment item is recorded and counted, but its outcome, feedback,
   * explanation and mastery changes stay hidden until the set ends; the finishing submission
   * returns the whole result (learning-engine.md#단원-평가-세트).
   */
  #withheld(input: {
    set: PracticeSet;
    item: PracticeItemRow;
    plan: EnginePlan | null;
    attemptId: string;
    attemptNo: number;
    attemptInItem: number;
  }): SubmitAttemptResponse {
    const { set, item, plan, attemptId, attemptNo, attemptInItem } = input;
    const orm = this.#userDb.orm;
    const items = plan?.items ?? listItems(orm, set.row.id);
    const applied = plan !== null;
    return {
      withheld: true,
      attempt: {
        id: attemptId,
        engineApplied: applied,
        attemptNo,
        attemptInItem: applied ? attemptInItem : attemptInItem - 1,
      },
      item: {
        id: item.id,
        status: applied ? 'answered' : item.status,
        attempts: applied ? attemptInItem : attemptInItem - 1,
      },
      set: {
        id: set.row.id,
        status: plan?.setFinished ? 'completed' : set.row.status,
        progress: progressOf(items),
        nextItemId: plan?.setFinished ? null : nextItemIdOf(items),
        result: plan?.result
          ? resultView(plan.result, this.#content.repo, { orm, setId: set.row.id })
          : null,
      },
    };
  }
}

/** API view of the items an attempt or skip replaced or appended. */
function adaptationsOf(repo: ContentRepository, plan: EnginePlan | null): SetAdaptation[] {
  if (!plan) return [];
  const rows = [
    ...plan.replaced.map((row) => ({ kind: 'replace' as const, row })),
    ...plan.appended.map((row) => ({ kind: 'append' as const, row })),
  ];
  const concepts = repo.getConcepts(
    rows.flatMap(({ row }) => (row.targetConceptId === null ? [] : [row.targetConceptId])),
  );
  return rows.map(({ kind, row }) => ({
    kind,
    itemId: row.id,
    position: row.position,
    exerciseId: row.exerciseId,
    reason: row.reason,
    targetConcept:
      row.targetConceptId === null
        ? null
        : {
            id: row.targetConceptId,
            title: concepts.get(row.targetConceptId)?.title ?? row.targetConceptId,
          },
  }));
}

/** Writes misconception observations (insert for new rows, update in place otherwise). */
export function writeSignals(orm: UserDb['orm'], learnerId: string, signals: Signals): void {
  for (const update of signals.updates) {
    const rowId =
      update.before === null ? null : (signals.stored.get(update.misconceptionId)?.rowId ?? null);
    writeObservation(orm, learnerId, rowId, update);
  }
}

function toPassJson(pass: PassResult): NonNullable<PracticeResultJson['pass']> {
  const { minConceptScore } = pass.checks;
  return {
    passed: pass.passed,
    checks: {
      ...pass.checks,
      minConceptScore: { ...minConceptScore, below: [...minConceptScore.below] },
    },
  };
}

export function gradingOf(grade: GradeResult, run: RunResult | null): GradingJson {
  return {
    v: 1,
    graderVersion: grade.graderVersion,
    correct: grade.correct,
    engineApplicable: grade.engineApplicable,
    runStatus: run?.status ?? null,
    feedback: grade.feedback,
    ...(grade.checkResults ? { checkResults: grade.checkResults } : {}),
    ...(grade.failedRequirements ? { failedRequirements: grade.failedRequirements } : {}),
    ...(grade.milestones ? { milestones: grade.milestones } : {}),
  };
}

/** Trims a run result for storage: first 200 console entries, at most 64KB. */
export function storedRun(run: RunResult): RunResultJson {
  let result = run;
  let truncated = run.consoleTruncated;
  if (result.console.length > RUN_CONSOLE_KEEP) {
    result = {
      ...result,
      console: result.console.slice(0, RUN_CONSOLE_KEEP),
      consoleTruncated: true,
    };
    truncated = true;
  }
  if (JSON.stringify(result).length > RUN_RESULT_MAX_BYTES) {
    result = { ...result, console: [], observations: [], consoleTruncated: true };
    truncated = true;
  }
  return { v: 1, truncated, result };
}
