import { buildRunPlan, exerciseOriginOf, redactSpec } from '@proginone/exercise-kit';
import {
  type ExerciseStats,
  HINT_LEVELS,
  type ExerciseView,
  type HintPolicy,
  type HintResponse,
  type PracticeContext,
  type ReportRequest,
  type ReportResponse,
  type RunPlan,
  type RunPlanRequest,
  type SolutionResponse,
} from '@proginone/shared';
import type { ContentExercise } from '../../db/content/repository.ts';
import { countExerciseScopeAttempts } from '../../db/user/attempts.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { exerciseStats } from '../../db/user/exercise-stats.ts';
import {
  findItem,
  hintState,
  insertHintEvent,
  insertReport,
  listHintEvents,
  type HintScope,
} from '../../db/user/exercise-records.ts';
import { ensureLearner, newId } from '../../db/user/learners.ts';
import { inActiveAssessment } from '../../db/user/practice-sets.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { kit, loadSpec } from './kit.ts';
import { solutionView } from './solution-view.ts';

export interface ExerciseServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  now: Clock;
  /** `hints.policy` from settings (D-047). Default `standard`. */
  hintPolicy?: () => HintPolicy;
}

/** Items that open hint 1 by themselves (easier relearning item), so never wait for a try. */
const HINT_FIRST_REASONS = new Set(['remedial_easier']);

/**
 * Reading an exercise and the actions around solving it that are not attempts: run plans,
 * hints, the solution view and reports. Answer keys never leave this service: the view uses
 * `redactSpec`, run plans come from `buildRunPlan` (no expected values).
 */
export class ExerciseService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #now: Clock;
  readonly #hintPolicy: () => HintPolicy;

  constructor(deps: ExerciseServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#now = deps.now;
    this.#hintPolicy = deps.hintPolicy ?? (() => 'standard');
  }

  /** `after-attempt`: the first hint waits for one submission in this context (D-047). */
  #assertTriedFirst(scope: HintScope): void {
    if (this.#hintPolicy() !== 'after-attempt') return;
    const orm = this.#userDb.orm;
    if (scope.itemId !== null) {
      const reason = findItem(orm, scope.learnerId, scope.itemId)?.item.reason;
      if (reason !== undefined && HINT_FIRST_REASONS.has(reason)) return;
    }
    if (countExerciseScopeAttempts(orm, scope) > 0) return;
    throw new AppError(
      'EXERCISE_TRY_FIRST',
      409,
      '먼저 한 번 답을 제출해 본 뒤에 힌트를 볼 수 있어요. (설정 > 학습 방식에서 바꿀 수 있어요)',
      { details: { exerciseId: scope.exerciseId } },
    );
  }

  #exercise(id: string): ContentExercise {
    const exercise = this.#content.repo.getExercise(id);
    if (!exercise) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', { details: { id } });
    }
    return exercise;
  }

  /** Validates the optional practice context: the item must be the learner's and this exercise's. */
  #scope(exerciseId: string, ctx: PracticeContext): HintScope {
    const learnerId = ensureLearner(this.#userDb).id;
    const itemId = ctx.practiceSetItemId ?? null;
    if (itemId !== null) {
      const found = findItem(this.#userDb.orm, learnerId, itemId);
      if (found?.item.exerciseId !== exerciseId) {
        throw new AppError('NOT_FOUND', 404, '연습 항목을 찾을 수 없습니다.', {
          details: { practiceSetItemId: itemId },
        });
      }
    }
    return { learnerId, exerciseId, itemId };
  }

  /**
   * Refuses help on an item of an assessment in progress (learning-engine.md#단원-평가-세트), by
   * the context item or by the exercise itself (a request without context must not get around
   * the lock).
   */
  #assertNotInAssessment(scope: HintScope, what: 'hints' | 'solution'): void {
    const orm = this.#userDb.orm;
    const byItem =
      scope.itemId !== null &&
      (() => {
        const found = findItem(orm, scope.learnerId, scope.itemId);
        return found?.setKind === 'assessment' && found.setStatus === 'active';
      })();
    if (byItem || inActiveAssessment(orm, scope.learnerId, scope.exerciseId)) {
      throw new AppError(
        'EXERCISE_LOCKED_IN_ASSESSMENT',
        403,
        what === 'hints'
          ? '단원 평가 중에는 힌트를 볼 수 없습니다. 평가가 끝나면 열려요.'
          : '단원 평가 중에는 정답을 볼 수 없습니다. 평가가 끝나면 열려요.',
        { details: { exerciseId: scope.exerciseId } },
      );
    }
  }

  view(id: string, ctx: PracticeContext): ExerciseView {
    const exercise = this.#exercise(id);
    const { def, spec } = loadSpec(exercise);
    const scope = this.#scope(id, ctx);
    // Shuffle options per item so a retry shows the same order; outside a set per exercise.
    const publicSpec = kit(() =>
      redactSpec(exercise.type, spec, { shuffleSeed: scope.itemId ?? exercise.id }),
    ) as Record<string, unknown>;
    const events = listHintEvents(this.#userDb.orm, scope);
    const { level, solutionViewed } = hintState(events);
    const levels = exercise.hints.levels;
    return {
      id: exercise.id,
      type: exercise.type,
      category: def.category,
      difficulty: exercise.difficulty,
      lessonId: exercise.lessonId,
      prompt: exercise.prompt,
      code: exercise.code,
      codeLanguage:
        exercise.lessonId === null
          ? null
          : this.#content.repo.courseLanguageOfLesson(exercise.lessonId),
      publicSpec,
      estimatedSeconds: exercise.estimatedSeconds,
      requiresRun: def.requiresRun(spec),
      writing: def.writing(spec),
      hintCount: levels.length,
      openedHints: levels.slice(0, level).map((text, i) => ({ level: i + 1, text })),
      solutionViewed,
    };
  }

  /**
   * Run plan for the browser sandbox. Only for specs graded from a run: running a
   * `predict_output` snippet before answering would give the answer away.
   */
  runPlan(id: string, request: RunPlanRequest): RunPlan {
    const exercise = this.#exercise(id);
    const { def, spec } = loadSpec(exercise);
    if (!def.supportsRunPlan || !def.requiresRun(spec)) {
      throw new AppError('EXERCISE_NOT_RUNNABLE', 409, '이 문제는 코드를 실행하지 않습니다.', {
        details: { type: exercise.type },
      });
    }
    return kit(() =>
      buildRunPlan({
        typeId: exercise.type,
        spec,
        answer: request.answer,
        purpose: request.purpose,
      }),
    );
  }

  /** Opens the next hint level (1 → 3) in the context and records it. */
  openHint(id: string, ctx: PracticeContext): HintResponse {
    const exercise = this.#exercise(id);
    const scope = this.#scope(id, ctx);
    this.#assertNotInAssessment(scope, 'hints');
    const levels = exercise.hints.levels.slice(0, HINT_LEVELS);
    const orm = this.#userDb.orm;
    return orm.transaction(() => {
      const { level } = hintState(listHintEvents(orm, scope));
      if (level === 0) this.#assertTriedFirst(scope);
      if (level >= levels.length) {
        throw new AppError('EXERCISE_HINTS_EXHAUSTED', 409, '더 열 수 있는 힌트가 없습니다.', {
          details: { hintCount: levels.length },
        });
      }
      const next = level + 1;
      insertHintEvent(orm, {
        id: newId(),
        learnerId: scope.learnerId,
        exerciseId: id,
        practiceSetItemId: scope.itemId,
        kind: 'hint',
        level: next,
        createdAt: new Date(this.#now()),
      });
      return {
        level: next,
        text: levels[next - 1] ?? '',
        hintCount: levels.length,
        remaining: levels.length - next,
      };
    });
  }

  /**
   * The explanation and reference answer. Locked until every hint was opened (D-010); the first
   * view in the context is recorded so later attempts count as `solution_viewed`.
   */
  viewSolution(id: string, ctx: PracticeContext): SolutionResponse {
    const exercise = this.#exercise(id);
    const { spec } = loadSpec(exercise);
    const scope = this.#scope(id, ctx);
    this.#assertNotInAssessment(scope, 'solution');
    const required = Math.min(HINT_LEVELS, exercise.hints.levels.length);
    const orm = this.#userDb.orm;
    orm.transaction(() => {
      const state = hintState(listHintEvents(orm, scope));
      if (state.level < required) {
        throw new AppError(
          'EXERCISE_SOLUTION_LOCKED',
          409,
          '힌트를 모두 열어 본 뒤에 정답을 볼 수 있습니다.',
          { details: { hintsOpened: state.level, hintsRequired: required } },
        );
      }
      if (!state.solutionViewed) {
        insertHintEvent(orm, {
          id: newId(),
          learnerId: scope.learnerId,
          exerciseId: id,
          practiceSetItemId: scope.itemId,
          kind: 'solution',
          level: null,
          createdAt: new Date(this.#now()),
        });
      }
    });
    return { explanation: exercise.explanation, solution: solutionView(exercise.type, spec) };
  }

  /**
   * Records a report and stops serving the exercise to this learner
   * (content-and-exercises.md#문제-신고-처리). Recomputing mastery for `wrong_answer` reports is
   * left to the recompute command (v0.2).
   */
  /** `GET /exercises/:id/stats` (FR-EX-10): the learner's statistics, derived from attempts. */
  stats(id: string): ExerciseStats {
    this.#exercise(id);
    const learnerId = ensureLearner(this.#userDb).id;
    const stats = exerciseStats(this.#userDb.orm, learnerId, [id]).get(id);
    if (!stats) throw new Error('exerciseStats returned no row for a requested exercise');
    return stats;
  }

  report(id: string, request: ReportRequest): ReportResponse {
    const exercise = this.#exercise(id);
    const learnerId = ensureLearner(this.#userDb).id;
    const reportId = newId();
    insertReport(this.#userDb.orm, {
      id: reportId,
      learnerId,
      exerciseId: id,
      reason: request.reason,
      exerciseOrigin: exerciseOriginOf(exercise.id) ?? exercise.origin,
      excluded: true,
      note: request.note && request.note.length > 0 ? request.note : null,
      status: 'open',
      createdAt: new Date(this.#now()),
    });
    return { id: reportId, excluded: true };
  }
}
