import { ASSESSMENT_MAX_ITEMS } from '@proginone/content-schema';
import { CONTENT_DB_SCHEMA_VERSION, contentTables as t } from '@proginone/content-schema/db';
import type {
  CourseDetail,
  CourseList,
  CourseSummary,
  LessonConcept,
  LessonDetail,
  LessonSummary,
} from '@proginone/shared';
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
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

export type ConceptPrerequisiteRow = typeof t.conceptPrerequisites.$inferSelect;

/** A catalog misconception (content.db `misconceptions`). */
export interface MisconceptionDetail {
  id: string;
  conceptId: string;
  title: string;
  description: string;
  correction: string;
}

export interface CourseLessonEstimate {
  id: string;
  title: string;
  courseId: string;
  estimatedMinutes: number;
  readMinutes: number;
}

export interface ConceptDetailRow {
  id: string;
  title: string;
  summary: string;
  importance: 'core' | 'standard' | 'minor';
  mdnUrl: string | null;
  course: { id: string; title: string };
  lessons: { id: string; title: string; role: 'introduces' | 'practices' | 'reviews' }[];
}

export interface LessonPlan {
  id: string;
  title: string;
  importance: 'core' | 'standard' | 'minor';
  /** `lesson.yaml` `practice.passRule` overrides (unvalidated numbers). */
  passRule: Record<string, number>;
  introduces: string[];
  reviews: string[];
  contentHash: string;
}

/** An `assessments` row (the ID is the `kind: assessment` lesson's ID). */
export interface ContentAssessment {
  id: string;
  title: string;
  /** Module the assessment closes. */
  scopeId: string;
  exerciseIds: string[];
  /** Assessed concepts in content order. */
  conceptIds: string[];
  /** `null` = every item (up to the engine's maximum). */
  itemCount: number | null;
  passRatio: number;
}

export interface ContentConcept {
  id: string;
  title: string;
  importance: 'core' | 'standard' | 'minor';
  /** Module of the lesson that introduces the concept (review set interleaving). */
  moduleId: string;
  courseId: string;
  introducedInLessonId: string;
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
  /** Misconceptions the exercise's wrong options/patterns point to. */
  misconceptionIds: string[];
  /** `usage: worked_example`: 0 full solution · 1 partial blanks · 2 solve. */
  workedExampleStage: number | null;
  /** Normalized answer-leak fingerprints (AI output post-check, server only). */
  leakFingerprints: string[];
}

/** Read-only access to content.db (docs/design/data-model.md#contentdb-설계). */
export class ContentRepository {
  readonly #db: Db;
  readonly packVersion: string;
  readonly #close: () => void;
  #prerequisites: ConceptPrerequisiteRow[] | undefined;
  #targets: Map<string, Set<string>> | undefined;

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
      // Practice items, and the items of assessment units (only they hold `usage: assessment`).
      .where(inArray(t.exercises.usage, ['practice', 'assessment']))
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
      misconceptionIds: row.misconceptionIds,
      workedExampleStage: row.workedExampleStage,
      leakFingerprints: row.leakFingerprints,
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

  /**
   * Practice candidates for a lesson set: the lesson's practice exercises plus practice
   * exercises whose primary concept is one of `reviewConceptIds` (interleaving).
   */
  listPracticeExercises(lessonId: string, reviewConceptIds: readonly string[]): ContentExercise[] {
    const reviewed =
      reviewConceptIds.length === 0
        ? []
        : this.#db
            .select({ id: t.exerciseConcepts.exerciseId })
            .from(t.exerciseConcepts)
            .where(
              and(
                inArray(t.exerciseConcepts.conceptId, [...reviewConceptIds]),
                eq(t.exerciseConcepts.isPrimary, true),
              ),
            )
            .all()
            .map((r) => r.id);
    const rows = this.#db
      .select()
      .from(t.exercises)
      .where(
        and(
          eq(t.exercises.usage, 'practice'),
          reviewed.length === 0
            ? eq(t.exercises.lessonId, lessonId)
            : or(eq(t.exercises.lessonId, lessonId), inArray(t.exercises.id, reviewed)),
        ),
      )
      .orderBy(asc(t.exercises.id))
      .all();
    const concepts = this.#exerciseConcepts(rows.map((r) => r.id));
    return rows.map((r) => this.#toExercise(r, concepts.get(r.id) ?? []));
  }

  /** Practice exercises whose primary concept is one of `conceptIds` (review sets). */
  listPracticeExercisesForConcepts(conceptIds: readonly string[]): ContentExercise[] {
    return this.listExercisesForConcepts(conceptIds, ['practice']);
  }

  /**
   * Exercises of the given usages whose primary concept is one of `conceptIds` (remedial items,
   * worked examples, weakness sets).
   */
  listExercisesForConcepts(
    conceptIds: readonly string[],
    usages: readonly ContentExercise['usage'][],
  ): ContentExercise[] {
    if (conceptIds.length === 0 || usages.length === 0) return [];
    const ids = this.#db
      .select({ id: t.exerciseConcepts.exerciseId })
      .from(t.exerciseConcepts)
      .where(
        and(
          inArray(t.exerciseConcepts.conceptId, [...conceptIds]),
          eq(t.exerciseConcepts.isPrimary, true),
        ),
      )
      .all()
      .map((r) => r.id);
    if (ids.length === 0) return [];
    const rows = this.#db
      .select()
      .from(t.exercises)
      .where(and(inArray(t.exercises.usage, [...usages]), inArray(t.exercises.id, ids)))
      .orderBy(asc(t.exercises.id))
      .all();
    const concepts = this.#exerciseConcepts(rows.map((r) => r.id));
    return rows.map((r) => this.#toExercise(r, concepts.get(r.id) ?? []));
  }

  /** The unit assessment whose ID is `lessonId`, or null for other lessons. */
  getAssessment(lessonId: string): ContentAssessment | null {
    const row = this.#db.select().from(t.assessments).where(eq(t.assessments.id, lessonId)).get();
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      scopeId: row.scopeId,
      exerciseIds: row.exerciseIds,
      conceptIds: row.selectionRule?.conceptIds ?? [],
      itemCount: row.selectionRule?.itemCount ?? null,
      passRatio: row.passRatio,
    };
  }

  /** What the practice set builder needs about a lesson. */
  getLessonPlan(id: string): LessonPlan | null {
    const lesson = this.#db.select().from(t.lessons).where(eq(t.lessons.id, id)).get();
    if (!lesson) return null;
    const roles = this.#db
      .select()
      .from(t.lessonConcepts)
      .where(eq(t.lessonConcepts.lessonId, id))
      // Insertion order is the lesson's concept order (lesson.yaml).
      .orderBy(sql`rowid`)
      .all();
    return {
      id: lesson.id,
      title: lesson.title,
      importance: lesson.importance,
      passRule: lesson.passRule ?? {},
      introduces: roles.filter((r) => r.role === 'introduces').map((r) => r.conceptId),
      reviews: roles.filter((r) => r.role === 'reviews').map((r) => r.conceptId),
      contentHash: lesson.contentHash,
    };
  }

  /** Concepts by id with their importance and the module that introduces them. */
  getConcepts(ids: readonly string[]): Map<string, ContentConcept> {
    const out = new Map<string, ContentConcept>();
    if (ids.length === 0) return out;
    for (const row of this.#db
      .select({ concept: t.concepts, moduleId: t.lessons.moduleId })
      .from(t.concepts)
      .leftJoin(t.lessons, eq(t.concepts.introducedInLessonId, t.lessons.id))
      .where(inArray(t.concepts.id, [...new Set(ids)]))
      .all()) {
      out.set(row.concept.id, {
        id: row.concept.id,
        title: row.concept.title,
        importance: row.concept.importance,
        moduleId: row.moduleId ?? row.concept.courseId,
        courseId: row.concept.courseId,
        introducedInLessonId: row.concept.introducedInLessonId,
      });
    }
    return out;
  }

  /**
   * Lessons of a course in reading order with their time estimates (pace and today's plan).
   * Only `kind: lesson` units count; assessments and projects are planned elsewhere.
   */
  listCourseLessons(courseId: string): CourseLessonEstimate[] {
    return this.#db
      .select({
        id: t.lessons.id,
        title: t.lessons.title,
        estimatedMinutes: t.lessons.estimatedMinutes,
        readMinutes: t.lessons.readMinutes,
        kind: t.lessons.kind,
      })
      .from(t.lessons)
      .innerJoin(t.modules, eq(t.lessons.moduleId, t.modules.id))
      .where(eq(t.modules.courseId, courseId))
      .orderBy(asc(t.modules.orderIndex), asc(t.lessons.orderIndex))
      .all()
      .filter((l) => l.kind === 'lesson')
      .map(({ kind: _kind, ...l }) => ({ ...l, courseId }));
  }

  /** Course of a lesson, or null. */
  courseOfLesson(lessonId: string): string | null {
    return (
      this.#db
        .select({ courseId: t.modules.courseId })
        .from(t.lessons)
        .innerJoin(t.modules, eq(t.lessons.moduleId, t.modules.id))
        .where(eq(t.lessons.id, lessonId))
        .get()?.courseId ?? null
    );
  }

  /** Language of a lesson's course (`html`, `css`, `javascript`), or null. */
  courseLanguageOfLesson(lessonId: string): (typeof t.courses.$inferSelect)['language'] | null {
    return (
      this.#db
        .select({ language: t.courses.language })
        .from(t.lessons)
        .innerJoin(t.modules, eq(t.lessons.moduleId, t.modules.id))
        .innerJoin(t.courses, eq(t.modules.courseId, t.courses.id))
        .where(eq(t.lessons.id, lessonId))
        .get()?.language ?? null
    );
  }

  /** Published/preview courses in catalog order (the first one starts a new learner). */
  listCourseIds(): string[] {
    return this.#db
      .select({ id: t.courses.id })
      .from(t.courses)
      .innerJoin(t.tracks, eq(t.courses.trackId, t.tracks.id))
      .where(inArray(t.courses.status, ['published', 'preview']))
      .orderBy(asc(t.tracks.orderIndex), asc(t.courses.orderIndex))
      .all()
      .map((r) => r.id);
  }

  /**
   * Concepts of a course in learning order (concept map, ui-ux.md 개념 지도): grouped by the module
   * of the lesson that introduces them, in module, lesson and `lesson.yaml` concept order.
   */
  listCourseConcepts(courseId: string): (ContentConcept & { summary: string })[] {
    return this.#db
      .select({
        id: t.concepts.id,
        title: t.concepts.title,
        summary: t.concepts.summary,
        importance: t.concepts.importance,
        moduleId: t.lessons.moduleId,
        introducedInLessonId: t.concepts.introducedInLessonId,
      })
      .from(t.concepts)
      .innerJoin(t.lessons, eq(t.concepts.introducedInLessonId, t.lessons.id))
      .innerJoin(t.modules, eq(t.lessons.moduleId, t.modules.id))
      .leftJoin(
        t.lessonConcepts,
        and(
          eq(t.lessonConcepts.lessonId, t.concepts.introducedInLessonId),
          eq(t.lessonConcepts.conceptId, t.concepts.id),
        ),
      )
      .where(eq(t.modules.courseId, courseId))
      .orderBy(
        asc(t.modules.orderIndex),
        asc(t.lessons.orderIndex),
        sql`${t.lessonConcepts}.rowid`,
        asc(t.concepts.id),
      )
      .all()
      .map((row) => ({ ...row, courseId }));
  }

  /** A concept with its course and the lessons that use it (concept detail). */
  getConceptDetail(id: string): ConceptDetailRow | null {
    const row = this.#db
      .select({ concept: t.concepts, courseTitle: t.courses.title, status: t.courses.status })
      .from(t.concepts)
      .innerJoin(t.courses, eq(t.concepts.courseId, t.courses.id))
      .where(eq(t.concepts.id, id))
      .get();
    if (!row || row.status === 'hidden') return null;
    const lessons = this.#db
      .select({ id: t.lessons.id, title: t.lessons.title, role: t.lessonConcepts.role })
      .from(t.lessonConcepts)
      .innerJoin(t.lessons, eq(t.lessonConcepts.lessonId, t.lessons.id))
      .innerJoin(t.modules, eq(t.lessons.moduleId, t.modules.id))
      .where(eq(t.lessonConcepts.conceptId, id))
      .orderBy(asc(t.modules.orderIndex), asc(t.lessons.orderIndex))
      .all();
    return {
      id: row.concept.id,
      title: row.concept.title,
      summary: row.concept.summary,
      importance: row.concept.importance,
      mdnUrl: row.concept.mdnUrl,
      course: { id: row.concept.courseId, title: row.courseTitle },
      lessons,
    };
  }

  /** Every `concept_prerequisites` edge (small; cached for the life of the pack). */
  listPrerequisites(): ConceptPrerequisiteRow[] {
    this.#prerequisites ??= this.#db
      .select()
      .from(t.conceptPrerequisites)
      .orderBy(asc(t.conceptPrerequisites.conceptId), asc(t.conceptPrerequisites.prerequisiteId))
      .all();
    return this.#prerequisites;
  }

  /**
   * Exercises that target each misconception (learning-engine.md#오개념-상태-전이): listed in
   * `remedial_exercise_ids_json`, or one of their wrong options/patterns points to it.
   */
  misconceptionTargets(): ReadonlyMap<string, ReadonlySet<string>> {
    if (this.#targets) return this.#targets;
    const targets = new Map<string, Set<string>>();
    const add = (mc: string, ex: string) => {
      const set = targets.get(mc) ?? new Set<string>();
      set.add(ex);
      targets.set(mc, set);
    };
    for (const row of this.#db
      .select({ id: t.misconceptions.id, remedial: t.misconceptions.remedialExerciseIds })
      .from(t.misconceptions)
      .all()) {
      for (const ex of row.remedial) add(row.id, ex);
    }
    for (const row of this.#db
      .select({ id: t.exercises.id, mcs: t.exercises.misconceptionIds })
      .from(t.exercises)
      .all()) {
      for (const mc of row.mcs) add(mc, row.id);
    }
    this.#targets = targets;
    return targets;
  }

  /** Misconceptions an exercise targets (inverse of {@link misconceptionTargets}). */
  misconceptionsTargetedBy(exerciseId: string): string[] {
    const out: string[] = [];
    for (const [mc, exercises] of this.misconceptionTargets()) {
      if (exercises.has(exerciseId)) out.push(mc);
    }
    return out.sort();
  }

  /** Misconceptions by id (titles for feedback, concepts for the engine). */
  getMisconceptions(ids: readonly string[]): Map<string, { title: string; conceptId: string }> {
    const out = new Map<string, { title: string; conceptId: string }>();
    if (ids.length === 0) return out;
    for (const row of this.#db
      .select()
      .from(t.misconceptions)
      .where(inArray(t.misconceptions.id, [...new Set(ids)]))
      .all()) {
      out.set(row.id, { title: row.title, conceptId: row.conceptId });
    }
    return out;
  }

  /**
   * Catalog misconceptions with their descriptions (tutor context, AI proposals), by id and/or by
   * concept. Ordered by concept, then id.
   */
  listMisconceptionDetails(query: {
    ids?: readonly string[];
    conceptIds?: readonly string[];
  }): MisconceptionDetail[] {
    const ids = [...new Set(query.ids ?? [])];
    const conceptIds = [...new Set(query.conceptIds ?? [])];
    if (ids.length === 0 && conceptIds.length === 0) return [];
    return this.#db
      .select()
      .from(t.misconceptions)
      .where(
        or(
          ids.length > 0 ? inArray(t.misconceptions.id, ids) : undefined,
          conceptIds.length > 0 ? inArray(t.misconceptions.conceptId, conceptIds) : undefined,
        ),
      )
      .orderBy(asc(t.misconceptions.conceptId), asc(t.misconceptions.id))
      .all()
      .map((row) => ({
        id: row.id,
        conceptId: row.conceptId,
        title: row.title,
        description: row.description,
        correction: row.correction,
      }));
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
    const assessment = lesson.kind === 'assessment' ? this.getAssessment(lesson.id) : null;
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
      assessment: assessment && {
        itemCount: Math.min(
          assessment.itemCount ?? assessment.exerciseIds.length,
          assessment.exerciseIds.length,
          ASSESSMENT_MAX_ITEMS,
        ),
        passRatio: assessment.passRatio,
        conceptCount: assessment.conceptIds.length,
        estimatedMinutes: lesson.estimatedMinutes - lesson.readMinutes,
      },
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
