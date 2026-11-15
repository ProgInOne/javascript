import { createHash } from 'node:crypto';
import { gradeSubmission, parseAnswer, redactSpec } from '@proginone/exercise-kit';
import {
  applyAttempt,
  localDateOf,
  type AttemptFacts,
  type EngineDeps,
  type HintLevel,
} from '@proginone/learning-engine';
import {
  parseRunResult,
  type ProjectAttemptRequest,
  type ProjectAttemptResponse,
  type ProjectView,
  type RunResult,
} from '@proginone/shared';
import {
  projectMilestones,
  type ContentExercise,
  type LessonPlan,
} from '../../db/content/repository.ts';
import {
  countExerciseAttempts,
  insertAttempt,
  insertSnapshot,
  insertSubmission,
} from '../../db/user/attempts.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { hintState, listHintEvents } from '../../db/user/exercise-records.ts';
import { newId } from '../../db/user/learners.ts';
import { insertEvidence, loadConceptStates, upsertMastery } from '../../db/user/learning-state.ts';
import {
  countGradedRuns,
  latestGradedRun,
  latestProjectAnswer,
} from '../../db/user/project-attempts.ts';
import {
  addDailyActivity,
  getLessonProgress,
  upsertLessonProgress,
  type LessonProgressRow,
} from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { gradingOf, storedRun, writeSignals } from './attempt-service.ts';
import { candidateOf, learnerContext } from './engine.ts';
import { kit, loadSpec } from './kit.ts';
import { misconceptionChanges, misconceptionInput } from './signals.ts';

export interface ProjectServiceDeps {
  userDb: UserDb;
  content: ContentAccess;
  engine: EngineDeps;
  now: Clock;
}

/**
 * Project units (`kind: project`, content-and-exercises.md#프로젝트-단원-kind-project): the
 * learner builds one milestone `web_task` step by step, outside practice sets. Every grading run
 * is stored as an attempt (`practice_set_item_id` NULL) so the screen can show the latest
 * milestone results and resume from the latest code. Mastery is updated once, by the run that
 * first passes every milestone (D-048): earlier runs are unfinished work, not wrong answers, and
 * later runs repeat finished work. That run counts as a first try (`attemptInItem` 1, the
 * project's runs are building steps), keeps the hint/solution/tutor weights, has no FSRS rating
 * and the default learning context (`W_ctx` 1.0).
 */
export class ProjectService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #engine: EngineDeps;
  readonly #now: Clock;

  constructor(deps: ProjectServiceDeps) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
    this.#engine = deps.engine;
    this.#now = deps.now;
  }

  get(lessonId: string): ProjectView {
    const { exercise } = this.#project(lessonId);
    const { learnerId } = learnerContext(this.#userDb);
    return this.#view(lessonId, exercise, learnerId);
  }

  submit(lessonId: string, request: ProjectAttemptRequest): ProjectAttemptResponse {
    const now = this.#now();
    const orm = this.#userDb.orm;
    const repo = this.#content.repo;
    const { exercise } = this.#project(lessonId);
    if (request.exerciseId !== exercise.id) {
      throw new AppError('PRACTICE_ITEM_MISMATCH', 400, '이 프로젝트의 문제가 아닙니다.', {
        details: { expected: exercise.id, received: request.exerciseId },
      });
    }
    const candidate = candidateOf(exercise);
    if (!candidate) {
      throw new AppError('EXERCISE_UNSUPPORTED', 500, '이 문제는 채점할 수 없습니다.', {
        details: { id: exercise.id },
      });
    }
    const { learnerId, dayBoundary } = learnerContext(this.#userDb);

    // Grade with the server spec; the run result is untrusted.
    const { spec } = loadSpec(exercise);
    const answer = kit(() => parseAnswer(exercise.type, request.answer));
    let run: RunResult | null = null;
    if (request.runResult !== undefined) {
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

    const progress = getLessonProgress(orm, learnerId, lessonId);
    const previous = latestGradedRun(orm, learnerId, exercise.id);
    const wasCompleted = progress?.status === 'completed';
    const graded = grade.engineApplicable;
    const completedNow = graded && grade.correct && !wasCompleted;

    const misconceptions = repo.getMisconceptions(grade.misconceptionIds);
    const hints = hintState(
      listHintEvents(orm, { learnerId, exerciseId: exercise.id, itemId: null }),
    );
    const attemptId = newId();
    const attemptNo = countExerciseAttempts(orm, learnerId, exercise.id) + 1;
    const startedAt = Math.min(request.startedAt, now);
    const activeMs = Math.min(request.activeMs, now - startedAt);
    const facts: AttemptFacts = {
      attemptId,
      outcome: grade.outcome,
      score: grade.score,
      confidence: null,
      hintLevelMax: Math.min(3, hints.level) as HintLevel,
      solutionViewed: hints.solutionViewed,
      tutorAssisted: request.tutorAssisted ?? false,
      attemptInItem: 1,
      activeMs,
      setKind: null,
      misconceptionConceptIds: [...misconceptions.values()].map((m) => m.conceptId),
      submittedAt: now,
    };
    const mc = completedNow
      ? misconceptionInput(repo, orm, learnerId, candidate, grade.misconceptionIds)
      : null;
    const effects = completedNow
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
        exerciseOrigin: exercise.origin,
        variantGroupKey: candidate.variantGroupKey,
        exerciseVersionHash: exercise.contentHash,
        practiceSetItemId: null,
        studySessionId: null,
        attemptNo,
        attemptInItem: completedNow ? 1 : 0,
        outcome: grade.outcome,
        score: grade.score,
        confidence: null,
        hintLevelMax: facts.hintLevelMax,
        solutionViewed: facts.solutionViewed,
        tutorAssisted: facts.tutorAssisted,
        startedAt: new Date(startedAt),
        submittedAt: new Date(now),
        activeMs,
        misconceptionIds: grade.misconceptionIds,
        grading: gradingOf(grade, run),
        isReview: false,
        // Only the completing run feeds the engine (see the class comment).
        engineApplied: completedNow,
      });
      insertSubmission(orm, {
        attemptId,
        learnerId,
        answer,
        runResult: run === null ? null : storedRun(run),
        answerHash: createHash('sha256').update(JSON.stringify(answer)).digest('hex'),
      });
      if (effects) {
        // FSRS ratings are dropped: spaced scheduling comes from practice and review sets.
        for (const update of effects.mastery) upsertMastery(orm, learnerId, update, now);
        for (const record of effects.evidence) insertEvidence(orm, learnerId, record);
        if (mc)
          writeSignals(orm, learnerId, { updates: effects.misconceptions, stored: mc.stored });
      }
      if (graded)
        upsertLessonProgress(orm, nextProgress(learnerId, lessonId, progress, completedNow, now));
      addDailyActivity(orm, learnerId, localDateOf(now, dayBoundary), {
        attempts: graded ? 1 : 0,
        correct: graded && grade.correct ? 1 : 0,
        lessonsCompleted: completedNow ? 1 : 0,
      });
    });

    const before = new Set(previous?.grading.milestones?.filter((m) => m.passed).map((m) => m.id));
    const titles = repo.getConcepts(effects?.mastery.map((m) => m.conceptId) ?? []);
    const view = this.#view(lessonId, exercise, learnerId);
    return {
      attempt: {
        id: attemptId,
        outcome: grade.outcome,
        score: grade.score,
        correct: grade.correct,
        graded,
        counted: completedNow,
        attemptNo,
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
        // The explanation walks through the whole solution: shown once the project is done.
        explanation: view.status === 'completed' ? exercise.explanation : '',
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
      newlyPassed: graded
        ? (grade.milestones ?? []).filter((m) => m.passed && !before.has(m.id)).map((m) => m.id)
        : [],
      completedNow,
      project: view,
    };
  }

  /** The project unit and its milestone `web_task`, or a 404/409. */
  #project(lessonId: string): { lesson: LessonPlan; exercise: ContentExercise } {
    const repo = this.#content.repo;
    const lesson = repo.getLessonPlan(lessonId);
    if (!lesson) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: lessonId },
      });
    }
    if (lesson.kind !== 'project') {
      throw new AppError('PRACTICE_KIND_MISMATCH', 409, '이 단원은 프로젝트가 아닙니다.', {
        details: { lessonId, expected: lesson.kind },
      });
    }
    const exercise = repo.getProjectExercise(lessonId);
    if (!exercise) {
      throw new AppError('PRACTICE_NO_EXERCISES', 409, '이 프로젝트에는 아직 과제가 없습니다.', {
        details: { lessonId },
      });
    }
    return { lesson, exercise };
  }

  #view(lessonId: string, exercise: ContentExercise, learnerId: string): ProjectView {
    const orm = this.#userDb.orm;
    const progress = getLessonProgress(orm, learnerId, lessonId);
    const last = latestGradedRun(orm, learnerId, exercise.id);
    const milestones = milestoneViews(exercise.spec, last?.grading.milestones ?? null);
    const saved = latestProjectAnswer(orm, learnerId, exercise.id);
    const files = saved && savedFiles(saved.answer);
    return {
      lessonId,
      exerciseId: exercise.id,
      status: progress?.status ?? 'not_started',
      completedAt: progress?.completedAt?.getTime() ?? null,
      milestones,
      passedCount: milestones.filter((m) => m.passed === true).length,
      runCount: countGradedRuns(orm, learnerId, exercise.id),
      lastRun: last && {
        attemptId: last.id,
        at: last.submittedAt,
        outcome: last.outcome,
        score: last.score,
      },
      savedAnswer: files && { files },
      savedAt: saved && files ? saved.at : null,
    };
  }
}

/**
 * Milestones of a project spec with the result of a graded run (`null`: no run yet). A failed
 * milestone after an earlier failed one is `blocked` when it has `event` checks: they run in order
 * on one page after the earlier steps, so they may never have been reached.
 */
export function milestoneViews(
  spec: Record<string, unknown>,
  results: readonly { id: string; passed: boolean }[] | null,
): ProjectView['milestones'] {
  const passed = new Map(results?.map((m) => [m.id, m.passed]));
  const events = eventCheckIds(spec);
  let earlierFailed = false;
  return projectMilestones(spec).map((m) => {
    const ok = results ? (passed.get(m.id) ?? false) : null;
    const blocked = ok === false && earlierFailed && m.checks.some((c) => events.has(c));
    if (ok === false) earlierFailed = true;
    return { id: m.id, title: m.title, checkCount: m.checks.length, passed: ok, blocked };
  });
}

/** Ids of the spec's `event` checks (they run in order on one page, after the others). */
function eventCheckIds(spec: Record<string, unknown>): Set<string> {
  const checks = spec['checks'];
  if (!Array.isArray(checks)) return new Set();
  return new Set(
    checks.flatMap((c: unknown) => {
      if (!c || typeof c !== 'object') return [];
      const { kind, id } = c as { kind?: unknown; id?: unknown };
      return kind === 'event' && typeof id === 'string' ? [id] : [];
    }),
  );
}

/** Files of a stored code answer (`{ files: [{ path, content }] }`), or null. */
function savedFiles(answer: Record<string, unknown>): { path: string; content: string }[] | null {
  const files = answer['files'];
  if (!Array.isArray(files)) return null;
  const out = files.flatMap((f: unknown) => {
    if (!f || typeof f !== 'object') return [];
    const { path, content } = f as { path?: unknown; content?: unknown };
    return typeof path === 'string' && typeof content === 'string' ? [{ path, content }] : [];
  });
  return out.length > 0 ? out : null;
}

/**
 * Lesson progress after a graded run: the first run moves the unit to `practicing`, the run that
 * passes every milestone to `completed`. A completed project stays completed.
 */
function nextProgress(
  learnerId: string,
  lessonId: string,
  progress: LessonProgressRow | null,
  completedNow: boolean,
  now: number,
): LessonProgressRow {
  const completed = completedNow || progress?.status === 'completed';
  return {
    learnerId,
    lessonId,
    status: completed ? 'completed' : 'practicing',
    lastSectionId: progress?.lastSectionId ?? null,
    readProgress: progress?.readProgress ?? 0,
    // The preparation practice set, if any, stays the unit's set.
    practiceSetId: progress?.practiceSetId ?? null,
    startedAt: progress?.startedAt ?? new Date(now),
    completedAt: completedNow ? new Date(now) : (progress?.completedAt ?? null),
    contentHashSeen: progress?.contentHashSeen ?? null,
    updatedAt: new Date(now),
  };
}
