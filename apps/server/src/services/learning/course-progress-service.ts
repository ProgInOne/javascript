import type {
  CourseDetail,
  CourseProgressDetail,
  CourseProgressList,
  CourseProgressSummary,
} from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import { listLessonProgress, type LessonProgressRow } from '../../db/user/progress.ts';
import { AppError } from '../../http/errors.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from '../practice/engine.ts';

type ProgressRows = ReadonlyMap<string, LessonProgressRow>;

/** Completed lessons out of all of them; assessments and projects count like lessons (D-083). */
export function countCompleted(
  lessons: readonly { id: string }[],
  rows: ProgressRows,
): { total: number; completed: number } {
  return {
    total: lessons.length,
    completed: lessons.filter((l) => rows.get(l.id)?.status === 'completed').length,
  };
}

/** The learner's `lesson_progress` rows by lesson id. */
export function progressRows(userDb: UserDb): Map<string, LessonProgressRow> {
  const { learnerId } = learnerContext(userDb);
  return new Map(listLessonProgress(userDb.orm, learnerId).map((r) => [r.lessonId, r]));
}

/**
 * A course's progress summary (D-083). The lesson to do now is the most recently updated lesson
 * in progress (`reading`/`practicing`, like the dashboard's "이어서 학습"), else the first lesson
 * not completed in course order.
 */
export function courseProgressSummary(
  course: CourseDetail,
  rows: ProgressRows,
): CourseProgressSummary {
  const lessons = course.modules.flatMap((m) => m.lessons);
  const lessonCount = countCompleted(lessons, rows);
  const status = (id: string) => rows.get(id)?.status ?? 'not_started';
  const started = lessons.some((l) => status(l.id) !== 'not_started');
  const state =
    lessonCount.total > 0 && lessonCount.completed === lessonCount.total
      ? 'completed'
      : started
        ? 'in_progress'
        : 'not_started';

  const active = lessons
    .flatMap((l) => {
      const row = rows.get(l.id);
      return row && (row.status === 'reading' || row.status === 'practicing') ? [{ l, row }] : [];
    })
    .reduce<{ l: (typeof lessons)[number]; row: LessonProgressRow } | null>(
      (latest, cur) =>
        latest === null || cur.row.updatedAt.getTime() > latest.row.updatedAt.getTime()
          ? cur
          : latest,
      null,
    );
  const nextLesson = active?.l ?? lessons.find((l) => status(l.id) !== 'completed') ?? null;
  return {
    courseId: course.id,
    lessons: lessonCount,
    state,
    next: nextLesson
      ? { id: nextLesson.id, title: nextLesson.title, status: status(nextLesson.id) }
      : null,
  };
}

/**
 * `GET /course-progress` and `GET /courses/:id/progress` (FR-CUR-01, ui-ux.md 과정 목록과 과정
 * 상세, D-083): learner progress over a course, kept apart from the content-only course API that
 * the web caches for good.
 */
export class CourseProgressService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;

  constructor(deps: { userDb: UserDb; content: ContentAccess }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
  }

  list(): CourseProgressList {
    const repo = this.#content.repo;
    const rows = progressRows(this.#userDb);
    return {
      courses: repo.listCourseIds().flatMap((id) => {
        const course = repo.getCourse(id);
        return course ? [courseProgressSummary(course, rows)] : [];
      }),
    };
  }

  get(courseId: string): CourseProgressDetail {
    const course = this.#content.repo.getCourse(courseId);
    if (!course) {
      throw new AppError('NOT_FOUND', 404, '과정을 찾을 수 없습니다.', {
        details: { id: courseId },
      });
    }
    const rows = progressRows(this.#userDb);
    return {
      ...courseProgressSummary(course, rows),
      modules: course.modules.map((m) => ({
        moduleId: m.id,
        lessons: countCompleted(m.lessons, rows),
      })),
      lessonStatuses: course.modules.flatMap((m) =>
        m.lessons.map((l) => {
          const row = rows.get(l.id);
          return {
            lessonId: l.id,
            status: row?.status ?? 'not_started',
            readProgress: row?.readProgress ?? 0,
          };
        }),
      ),
    };
  }
}
