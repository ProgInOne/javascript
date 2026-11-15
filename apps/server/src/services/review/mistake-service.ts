import { redactSpec } from '@proginone/exercise-kit';
import {
  mistakeListQuerySchema,
  type AttemptContext,
  type MistakeAttempt,
  type MistakeDetail,
  type MistakeList,
  type MistakeListQuery,
  type MistakeNote,
  type SolutionView,
} from '@proginone/shared';
import type { ContentExercise, ContentRepository } from '../../db/content/repository.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { excludedExerciseIds } from '../../db/user/exercise-records.ts';
import {
  activeAssessmentExerciseIds,
  listGradedAttempts,
  loadSubmissions,
  solutionOpened,
  type GradedAttemptRow,
} from '../../db/user/review-history.ts';
import { AppError } from '../../http/errors.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { candidateOf, learnerContext } from '../practice/engine.ts';
import { kit, loadSpec } from '../practice/kit.ts';
import { answerView, solutionView } from '../practice/solution-view.ts';

/** Wrong attempts listed in a note's detail. */
const DETAIL_ATTEMPTS = 10;

const isWrong = (a: GradedAttemptRow) => a.outcome === 'incorrect' || a.outcome === 'partial';
const contextOf = (a: GradedAttemptRow): AttemptContext => a.setKind ?? 'inline';
/**
 * An attempt of an assessment that has not finished: its result was never shown, so it neither
 * opens nor resolves a note (learning-engine.md#단원-평가-세트).
 */
const withheld = (a: GradedAttemptRow) => a.setKind === 'assessment' && a.setStatus !== 'completed';

interface NoteFacts {
  exerciseId: string;
  /** Wrong attempts, newest first. */
  wrong: GradedAttemptRow[];
  resolvedAt: number | null;
}

/**
 * Mistake notes (ui-ux.md 오답 노트, glossary `MistakeNote`): derived from attempts, never stored.
 * One note per exercise with a wrong (`incorrect`/`partial`) attempt. A note is `resolved` once a
 * correct attempt made without the reference answer follows its latest wrong attempt.
 */
export class MistakeService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;

  constructor(deps: { userDb: UserDb; content: ContentAccess }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
  }

  /** Notes from the visible attempts, newest wrong attempt first. */
  #notes(learnerId: string, exerciseId?: string): NoteFacts[] {
    const orm = this.#userDb.orm;
    const hidden = activeAssessmentExerciseIds(orm, learnerId);
    const byExercise = new Map<string, GradedAttemptRow[]>();
    for (const a of listGradedAttempts(orm, learnerId, exerciseId)) {
      if (withheld(a) || hidden.has(a.exerciseId)) continue;
      const list = byExercise.get(a.exerciseId) ?? [];
      list.push(a);
      byExercise.set(a.exerciseId, list);
    }
    const notes: NoteFacts[] = [];
    for (const [id, list] of byExercise) {
      const wrong = list.filter(isWrong);
      const latest = wrong[0];
      if (!latest) continue;
      // `list` is newest first: the oldest correct attempt after the latest wrong one resolves it.
      const resolving = list
        .filter((a) => a.outcome === 'correct' && !a.solutionViewed)
        .filter((a) => a.submittedAt > latest.submittedAt)
        .at(-1);
      notes.push({ exerciseId: id, wrong, resolvedAt: resolving?.submittedAt ?? null });
    }
    return notes.sort(
      (a, b) =>
        (b.wrong[0]?.submittedAt ?? 0) - (a.wrong[0]?.submittedAt ?? 0) ||
        a.exerciseId.localeCompare(b.exerciseId),
    );
  }

  /** `GET /mistakes`. */
  list(rawQuery: MistakeListQuery = {}): MistakeList {
    const query = mistakeListQuerySchema.parse(rawQuery);
    const repo = this.#content.repo;
    const { learnerId } = learnerContext(this.#userDb);
    const facts = this.#notes(learnerId);
    const views = this.#views(repo, learnerId, facts);

    const scoped = views.filter(
      (n) =>
        (query.courseId === undefined || n.course?.id === query.courseId) &&
        (query.moduleId === undefined || n.module?.id === query.moduleId) &&
        (query.conceptId === undefined || n.concept?.id === query.conceptId),
    );
    const filtered = scoped.filter((n) => query.status === 'all' || n.status === query.status);
    const sorted =
      query.sort === 'confident'
        ? // Stable: recent order within each group.
          [...filtered].sort((a, b) => Number(b.confidentWrong) - Number(a.confidentWrong))
        : filtered;
    return {
      items: sorted.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
      counts: {
        all: scoped.length,
        open: scoped.filter((n) => n.status === 'open').length,
        resolved: scoped.filter((n) => n.status === 'resolved').length,
      },
      facets: facetsOf(repo, views),
    };
  }

  /** `GET /mistakes/:exerciseId`: the note with the learner's answers and what they have seen. */
  get(exerciseId: string): MistakeDetail {
    const repo = this.#content.repo;
    const orm = this.#userDb.orm;
    const { learnerId } = learnerContext(this.#userDb);
    const facts = this.#notes(learnerId, exerciseId)[0];
    if (!facts) {
      throw new AppError('NOT_FOUND', 404, '오답 노트에 없는 문제입니다.', {
        details: { exerciseId },
      });
    }
    const [note] = this.#views(repo, learnerId, [facts]);
    if (!note) throw new Error('note view missing');
    const exercise = repo.getExercise(exerciseId);
    let spec: unknown = null;
    let code: string | null = exercise?.code ?? null;
    if (exercise) {
      try {
        spec = loadSpec(exercise).spec;
        const publicSpec = kit(() => redactSpec(exercise.type, spec)) as Record<string, unknown>;
        if (code === null && typeof publicSpec['code'] === 'string') code = publicSpec['code'];
      } catch {
        spec = null; // A spec that no longer validates: show the note without answers.
      }
    }
    const shown = facts.wrong.slice(0, DETAIL_ATTEMPTS);
    const stored = loadSubmissions(
      orm,
      shown.map((a) => a.id),
    );
    const mcTitles = repo.getMisconceptions(shown.flatMap((a) => a.misconceptionIds));
    const attempts: MistakeAttempt[] = shown.map((a) => {
      const sub = stored.get(a.id);
      let answer: SolutionView = { kind: 'none' };
      if (exercise && spec !== null && sub) {
        try {
          answer = answerView(exercise.type, spec, sub.answer);
        } catch {
          answer = { kind: 'none' };
        }
      }
      return {
        id: a.id,
        submittedAt: a.submittedAt,
        outcome: a.outcome === 'partial' ? 'partial' : 'incorrect',
        confidence: a.confidence,
        context: contextOf(a),
        answer,
        misconceptions: a.misconceptionIds.map((id) => ({
          id,
          title: mcTitles.get(id)?.title ?? id,
        })),
        // Assessment items never showed per-item feedback, only the result screen.
        feedback: a.setKind === 'assessment' ? [] : (sub?.feedback ?? []),
        hintLevelMax: Math.min(3, Math.max(0, a.hintLevelMax)),
        solutionViewed: a.solutionViewed,
      };
    });

    // The reference answer only when the learner has seen it: opened through the hint ladder, or
    // shown on the result screen of a finished assessment that included the exercise.
    const solutionSource = solutionOpened(orm, learnerId, exerciseId)
      ? ('viewed' as const)
      : facts.wrong.some((a) => a.setKind === 'assessment')
        ? ('assessment' as const)
        : null;
    let solution: SolutionView | null = null;
    if (solutionSource !== null && exercise && spec !== null) {
      solution = solutionView(exercise.type, spec);
    }
    const lessonId = exercise?.lessonId ?? null;
    return {
      note,
      code,
      codeLanguage: lessonId === null ? null : repo.courseLanguageOfLesson(lessonId),
      attempts,
      explanation: exercise?.explanation ?? '',
      solution,
      solutionSource: solution === null ? null : solutionSource,
    };
  }

  #views(repo: ContentRepository, learnerId: string, facts: readonly NoteFacts[]): MistakeNote[] {
    const exercises = new Map(
      repo.getExercises(facts.map((f) => f.exerciseId)).map((e) => [e.id, e]),
    );
    const primary = (e: ContentExercise | undefined) =>
      e?.concepts.find((c) => c.isPrimary)?.conceptId ?? e?.concepts[0]?.conceptId ?? null;
    const concepts = repo.getConcepts(
      facts.flatMap((f) => {
        const id = primary(exercises.get(f.exerciseId));
        return id === null ? [] : [id];
      }),
    );
    const places = placesOf(repo, [...concepts.values()]);
    const mcTitles = repo.getMisconceptions(
      facts.flatMap((f) => f.wrong[0]?.misconceptionIds ?? []),
    );
    const excluded = excludedExerciseIds(this.#userDb.orm, learnerId);

    return facts.flatMap((f): MistakeNote[] => {
      const latest = f.wrong[0];
      if (!latest) return [];
      const exercise = exercises.get(f.exerciseId);
      const conceptId = primary(exercise);
      const concept = conceptId === null ? undefined : concepts.get(conceptId);
      const place = concept ? places.get(concept.id) : undefined;
      return [
        {
          exerciseId: f.exerciseId,
          type: exercise?.type ?? 'unknown',
          difficulty: Math.min(5, Math.max(1, exercise?.difficulty ?? 1)),
          prompt: exercise?.prompt ?? '',
          concept: concept ? { id: concept.id, title: concept.title } : null,
          module: place?.module ?? null,
          course: place?.course ?? null,
          lastWrongAt: latest.submittedAt,
          lastWrongOutcome: latest.outcome === 'partial' ? 'partial' : 'incorrect',
          lastWrongContext: contextOf(latest),
          wrongCount: f.wrong.length,
          confidentWrong: latest.confidence === 'sure',
          misconceptions: latest.misconceptionIds.map((id) => ({
            id,
            title: mcTitles.get(id)?.title ?? id,
          })),
          status: f.resolvedAt === null ? 'open' : 'resolved',
          resolvedAt: f.resolvedAt,
          archived: exercise === undefined,
          retry: retryOf(exercise, excluded),
        },
      ];
    });
  }
}

/** "다시 풀기" puts the same exercise in an `extra` set; see `PracticeSetService`. */
export function retryOf(
  exercise: ContentExercise | undefined,
  excluded: ReadonlySet<string>,
): MistakeNote['retry'] {
  const blockedBy: MistakeNote['retry']['blockedBy'] =
    exercise === undefined
      ? 'archived'
      : exercise.usage === 'assessment'
        ? 'assessment_only'
        : excluded.has(exercise.id)
          ? 'reported'
          : candidateOf(exercise) === null
            ? 'unsupported'
            : null;
  return { available: blockedBy === null, blockedBy };
}

interface Place {
  course: { id: string; title: string };
  module: { id: string; title: string } | null;
}

/** Course and module of each concept. */
function placesOf(
  repo: ContentRepository,
  concepts: readonly { id: string; courseId: string; moduleId: string }[],
): Map<string, Place> {
  const courses = new Map(
    [...new Set(concepts.map((c) => c.courseId))].map((id) => [id, repo.getCourse(id)]),
  );
  const out = new Map<string, Place>();
  for (const c of concepts) {
    const course = courses.get(c.courseId);
    if (!course) continue;
    const mod = course.modules.find((m) => m.id === c.moduleId);
    out.set(c.id, {
      course: { id: course.id, title: course.title },
      module: mod ? { id: mod.id, title: mod.title } : null,
    });
  }
  return out;
}

/** Filter choices from every note, in catalog order (courses, then modules, then concepts). */
function facetsOf(repo: ContentRepository, notes: readonly MistakeNote[]): MistakeList['facets'] {
  const courseIds = repo.listCourseIds();
  const courses = new Map<string, { id: string; title: string }>();
  const modules = new Map<string, { id: string; title: string; courseId: string }>();
  const concepts = new Map<string, { id: string; title: string; moduleId: string | null }>();
  for (const n of notes) {
    if (n.course) courses.set(n.course.id, n.course);
    if (n.course && n.module) modules.set(n.module.id, { ...n.module, courseId: n.course.id });
    if (n.concept) concepts.set(n.concept.id, { ...n.concept, moduleId: n.module?.id ?? null });
  }
  const rank = (id: string) => {
    const i = courseIds.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const moduleRank = new Map<string, number>();
  for (const id of [...courses.keys()]) {
    repo.getCourse(id)?.modules.forEach((m, i) => moduleRank.set(m.id, rank(id) * 1000 + i));
  }
  const byModule = (id: string | null) =>
    id === null ? Number.MAX_SAFE_INTEGER : (moduleRank.get(id) ?? Number.MAX_SAFE_INTEGER);
  return {
    courses: [...courses.values()].sort((a, b) => rank(a.id) - rank(b.id)),
    modules: [...modules.values()].sort((a, b) => byModule(a.id) - byModule(b.id)),
    concepts: [...concepts.values()].sort(
      (a, b) => byModule(a.moduleId) - byModule(b.moduleId) || a.title.localeCompare(b.title, 'ko'),
    ),
  };
}
