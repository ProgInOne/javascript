import { CONTENT_DB_SCHEMA_VERSION, contentTables as t } from '@proginone/content-schema/db';
import type {
  CourseDetail,
  CourseList,
  CourseSummary,
  LessonConcept,
  LessonDetail,
  LessonSummary,
} from '@proginone/shared';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { openSqlite } from '../user/connection.ts';

export class ContentDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentDbError';
  }
}

type Db = BetterSQLite3Database<typeof t>;

export interface ContentExerciseConcept {
  conceptId: string;
  weight: number;
  isPrimary: boolean;
}

/** An `exercises` row with its concept tags. `spec` holds answer keys (server only). */
export interface ContentExercise {
  id: string;
  type: string;
  difficulty: number;
  lessonId: string | null;
  usage: (typeof t.exercises.$inferSelect)['usage'];
  variantGroup: string | null;
  prompt: string;
  code: string | null;
  spec: Record<string, unknown>;
  hints: { v: 1; levels: string[] };
  explanation: string;
  estimatedSeconds: number;
  origin: 'authored' | 'template';
  contentHash: string;
  concepts: ContentExerciseConcept[];
}

/** Read-only access to content.db (docs/design/data-model.md#contentdb-설계). */
export class ContentRepository {
  readonly #db: Db;
  readonly packVersion: string;
  readonly #close: () => void;

  constructor(path: string) {
    const sqlite = openSqlite(path, { readonly: true });
    this.#db = drizzle(sqlite, { schema: t });
    this.#close = () => {
      sqlite.close();
    };
    const meta = new Map(
      this.#db
        .select()
        .from(t.contentMeta)
        .all()
        .map((r) => [r.key, r.value]),
    );
    if (meta.get('schema_version') !== String(CONTENT_DB_SCHEMA_VERSION)) {
      this.#close();
      throw new ContentDbError(
        `content.db 스키마 버전 ${meta.get('schema_version') ?? '없음'}은(는) 지원하지 않습니다(필요: ${CONTENT_DB_SCHEMA_VERSION}). \`pnpm content:build\`로 다시 만드세요.`,
      );
    }
    this.packVersion = meta.get('pack_version') ?? 'unknown';
  }

  close(): void {
    this.#close();
  }

  #lessonCounts() {
    const rows = this.#db
      .select({ lessonId: t.exercises.lessonId, n: count() })
      .from(t.exercises)
      .where(eq(t.exercises.usage, 'practice'))
      .groupBy(t.exercises.lessonId)
      .all();
    return new Map(rows.map((r) => [r.lessonId, r.n]));
  }

  #courseSummary(course: typeof t.courses.$inferSelect): CourseSummary {
    const lessonCount =
      this.#db
        .select({ n: count() })
        .from(t.lessons)
        .innerJoin(t.modules, eq(t.lessons.moduleId, t.modules.id))
        .where(eq(t.modules.courseId, course.id))
        .get()?.n ?? 0;
    return {
      id: course.id,
      title: course.title,
      summary: course.summary,
      language: course.language,
      level: course.level,
      estimatedMinutes: course.estimatedMinutes,
      lessonCount,
    };
  }

  listCourses(): CourseList {
    const tracks = this.#db.select().from(t.tracks).orderBy(asc(t.tracks.orderIndex)).all();
    return {
      packVersion: this.packVersion,
      tracks: tracks.map((track) => ({
        id: track.id,
        title: track.title,
        summary: track.summary,
        courses: this.#db
          .select()
          .from(t.courses)
          .where(
            and(
              eq(t.courses.trackId, track.id),
              inArray(t.courses.status, ['published', 'preview']),
            ),
          )
          .orderBy(asc(t.courses.orderIndex))
          .all()
          .map((c) => this.#courseSummary(c)),
      })),
    };
  }

  getCourse(id: string): CourseDetail | null {
    const course = this.#db.select().from(t.courses).where(eq(t.courses.id, id)).get();
    if (!course || course.status === 'hidden') return null;
    const counts = this.#lessonCounts();
    const modules = this.#db
      .select()
      .from(t.modules)
      .where(eq(t.modules.courseId, id))
      .orderBy(asc(t.modules.orderIndex))
      .all();
    return {
      ...this.#courseSummary(course),
      objectives: course.objectives,
      modules: modules.map((m) => ({
        id: m.id,
        title: m.title,
        summary: m.summary,
        lessons: this.#db
          .select()
          .from(t.lessons)
          .where(eq(t.lessons.moduleId, m.id))
          .orderBy(asc(t.lessons.orderIndex))
          .all()
          .map((l): LessonSummary => ({
            id: l.id,
            title: l.title,
            summary: l.summary,
            kind: l.kind,
            importance: l.importance,
            estimatedMinutes: l.estimatedMinutes,
            exerciseCount: counts.get(l.id) ?? 0,
          })),
      })),
    };
  }

  /** Lessons of a course in reading order (for previous/next). */
  #courseLessonOrder(courseId: string) {
    return this.#db
      .select({ id: t.lessons.id, title: t.lessons.title })
      .from(t.lessons)
      .innerJoin(t.modules, eq(t.lessons.moduleId, t.modules.id))
      .where(eq(t.modules.courseId, courseId))
      .orderBy(asc(t.modules.orderIndex), asc(t.lessons.orderIndex))
      .all();
  }

  /** Concept tags of the given exercises, primary first. */
  #exerciseConcepts(ids: readonly string[]): Map<string, ContentExerciseConcept[]> {
    const out = new Map<string, ContentExerciseConcept[]>();
    if (ids.length === 0) return out;
    for (const row of this.#db
      .select()
      .from(t.exerciseConcepts)
      .where(inArray(t.exerciseConcepts.exerciseId, [...ids]))
      .orderBy(desc(t.exerciseConcepts.isPrimary), asc(t.exerciseConcepts.conceptId))
      .all()) {
      const list = out.get(row.exerciseId) ?? [];
      list.push({ conceptId: row.conceptId, weight: row.weight, isPrimary: row.isPrimary });
      out.set(row.exerciseId, list);
    }
    return out;
  }

  #toExercise(row: typeof t.exercises.$inferSelect, concepts: ContentExerciseConcept[]) {
    const exercise: ContentExercise = {
      id: row.id,
      type: row.type,
      difficulty: row.difficulty,
      lessonId: row.lessonId,
      usage: row.usage,
      variantGroup: row.variantGroup,
      prompt: row.prompt,
      code: row.code,
      spec: row.spec,
      hints: row.hints,
      explanation: row.explanation,
      estimatedSeconds: row.estimatedSeconds,
      origin: row.origin,
      contentHash: row.contentHash,
      concepts,
    };
    return exercise;
  }

  /**
   * A full exercise including its server-only spec (answer keys). Never send `spec` to the
   * client; use exercise-kit `redactSpec`.
   */
  getExercise(id: string): ContentExercise | null {
    const row = this.#db.select().from(t.exercises).where(eq(t.exercises.id, id)).get();
    if (!row) return null;
    return this.#toExercise(row, this.#exerciseConcepts([id]).get(id) ?? []);
  }

  getExercises(ids: readonly string[]): ContentExercise[] {
    if (ids.length === 0) return [];
    const rows = this.#db
      .select()
      .from(t.exercises)
      .where(inArray(t.exercises.id, [...ids]))
      .all();
    const concepts = this.#exerciseConcepts(rows.map((r) => r.id));
    return rows.map((r) => this.#toExercise(r, concepts.get(r.id) ?? []));
  }

  getLesson(id: string): LessonDetail | null {
    const lesson = this.#db.select().from(t.lessons).where(eq(t.lessons.id, id)).get();
    if (!lesson) return null;
    const mod = this.#db.select().from(t.modules).where(eq(t.modules.id, lesson.moduleId)).get();
    const course =
      mod && this.#db.select().from(t.courses).where(eq(t.courses.id, mod.courseId)).get();
    if (!mod || !course || course.status === 'hidden') return null;

    const roles = this.#db
      .select({ concept: t.concepts, role: t.lessonConcepts.role })
      .from(t.lessonConcepts)
      .innerJoin(t.concepts, eq(t.lessonConcepts.conceptId, t.concepts.id))
      .where(eq(t.lessonConcepts.lessonId, id))
      .all();
    const concepts: LessonConcept[] = roles.map(({ concept, role }) => ({
      id: concept.id,
      title: concept.title,
      summary: concept.summary,
      importance: concept.importance,
      role,
    }));
    const linkedIds = [...collectConceptLinks(lesson.bodyCompiled)].filter(
      (c) => !concepts.some((x) => x.id === c),
    );
    if (linkedIds.length > 0) {
      for (const c of this.#db
        .select()
        .from(t.concepts)
        .where(inArray(t.concepts.id, linkedIds))
        .all()) {
        concepts.push({
          id: c.id,
          title: c.title,
          summary: c.summary,
          importance: c.importance,
          role: 'linked',
        });
      }
    }

    const order = this.#courseLessonOrder(course.id);
    const i = order.findIndex((l) => l.id === id);
    return {
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
      kind: lesson.kind,
      importance: lesson.importance,
      course: { id: course.id, title: course.title, language: course.language },
      module: { id: mod.id, title: mod.title },
      objectives: lesson.objectives,
      estimatedMinutes: lesson.estimatedMinutes,
      readMinutes: lesson.readMinutes,
      sections: lesson.sections.sections,
      body: lesson.bodyCompiled,
      concepts,
      previous: order[i - 1] ?? null,
      next: order[i + 1] ?? null,
      contentHash: lesson.contentHash,
    };
  }
}

/** Concept ids referenced by <ConceptLink to> and <RunnableExample concepts> in a lesson tree. */
function collectConceptLinks(nodes: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as {
      type?: unknown;
      name?: unknown;
      props?: Record<string, unknown>;
      children?: unknown;
    };
    if (node.type === 'component' && node.props) {
      if (node.name === 'ConceptLink' && typeof node.props['to'] === 'string')
        out.add(node.props['to']);
      const cs = node.props['concepts'];
      if (Array.isArray(cs)) for (const c of cs) if (typeof c === 'string') out.add(c);
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  if (Array.isArray(nodes)) nodes.forEach(visit);
  return out;
}
