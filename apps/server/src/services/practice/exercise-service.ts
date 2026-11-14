import { buildRunPlan, exerciseOriginOf, redactSpec } from '@proginone/exercise-kit';
import {
  HINT_LEVELS,
  type ExerciseView,
  type HintResponse,
  type PracticeContext,
  type ReportRequest,
  type ReportResponse,
  type RunPlan,
  type RunPlanRequest,
  type SolutionResponse,
} from '@proginone/shared';
import type { ContentExercise } from '../../db/content/repository.ts';
import type { UserDb } from '../../db/user/connection.ts';
import {
  findItem,
  hintState,
  insertHintEvent,
  insertReport,
  listHintEvents,
  type HintScope,
} from '../../db/user/exercise-records.ts';
import { ensureLearner, newId } from '../../db/user/learners.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { kit, loadSpec } from './kit.ts';
import { solutionView } from './solution-view.ts';

export interface ExerciseServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  now: Clock;
}

/**
 * Reading an exercise and the actions around solving it that are not attempts: run plans,
 * hints, the solution view and reports. Answer keys never leave this service: the view uses
 * `redactSpec`, run plans come from `buildRunPlan` (no expected values).
 */
export class ExerciseService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #now: Clock;

  constructor(deps: ExerciseServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#now = deps.now;
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
      publicSpec,
      estimatedSeconds: exercise.estimatedSeconds,
      requiresRun: def.requiresRun(spec),
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
    const levels = exercise.hints.levels.slice(0, HINT_LEVELS);
    const orm = this.#userDb.orm;
    return orm.transaction(() => {
      const { level } = hintState(listHintEvents(orm, scope));
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
