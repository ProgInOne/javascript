import { ASSESSMENT_MAX_ITEMS } from '@proginone/content-schema';
import { instantiateVariant, leakFingerprints, parseVariantId } from '@proginone/exercise-kit';
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
import type { ContentAlias } from '../user/content-aliases.ts';

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

export type LessonKind = (typeof t.lessons.$inferSelect)['kind'];

export interface CourseLessonEstimate {
  id: string;
  title: string;
  kind: LessonKind;
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
  kind: LessonKind;
  importance: 'core' | 'standard' | 'minor';
  /** `lesson.yaml` `practice.passRule` overrides (unvalidated numbers). */
  passRule: Record<string, number>;
  introduces: string[];
  /** `concepts.practiced` (a project unit's applied concepts). */
  practices: string[];
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

/** One servable variant of a template's verified seed pool. */
export interface TemplatePoolEntry {
  variantId: string;
  sampleIndex: number;
  /** Canonical answer (server only): "different from the last N answers" selection. */
  answerKey: string;
}

/** An `exercise_templates` row with its verified pool (D-056), without the template source. */
export interface ContentTemplate {
  id: string;
  type: string;
  difficulty: number;
  lessonId: string;
  usage: 'practice' | 'remedial';
  primaryConceptId: string;
  minDistinctFromRecent: number;
  pool: TemplatePoolEntry[];
}

/** Read-only access to content.db (docs/design/data-model.md#contentdb-설계). */
export class ContentRepository {
  readonly #db: Db;
  readonly packVersion: string;
  readonly #close: () => void;
  #prerequisites: ConceptPrerequisiteRow[] | undefined;
  #projectLessons: Set<string> | undefined;
  #targets: Map<string, Set<string>> | undefined;
  #templates: Map<string, ContentTemplate> | undefined;
  /** Instantiated variants by ID (pure and deterministic, so safe to keep for the process). */
  readonly #variants = new Map<string, ContentExercise | null>();

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

  /** Old slug → current slug mappings (FR-CUR-06, db/user/content-aliases.ts). */
  aliases(): ContentAlias[] {
    return this.#db
      .select({
        oldId: t.contentIdAliases.oldId,
        newId: t.contentIdAliases.newId,
        aliasKind: t.contentIdAliases.aliasKind,
        isPrimary: t.contentIdAliases.isPrimary,
        entityKind: t.contentIdAliases.entityKind,
      })
      .from(t.contentIdAliases)
      .orderBy(asc(t.contentIdAliases.oldId), asc(t.contentIdAliases.newId))
      .all();
  }

  /**
   * `kind: project` units. Their exercises (preparation practice) are served only in the unit's
   * own practice set, never in other units', review or weakness sets (D-048).
   */
  #projects(): Set<string> {
    this.#projectLessons ??= new Set(
      this.#db
        .select({ id: t.lessons.id })
        .from(t.lessons)
        .where(eq(t.lessons.kind, 'project'))
        .all()
        .map((r) => r.id),
    );
    return this.#projectLessons;
  }

  /** Whether an exercise belongs to another unit's project (kept out of shared candidates). */
  #inProject(lessonId: string | null): boolean {
    return lessonId !== null && this.#projects().has(lessonId);
  }

  #lessonCounts() {
    const rows = this.#db
      .select({ lessonId: t.exercises.lessonId, n: count() })
      .from(t.exercises)
      // Practice items, and the items of assessment and project units (only they hold
      // `usage: assessment` / `usage: project`).
      .where(inArray(t.exercises.usage, ['practice', 'assessment', 'project']))
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
   * client; use exercise-kit `redactSpec`. Template variant IDs (`<template id>@<seed>`) resolve
   * to an instantiated variant when the seed is in the template's verified pool (D-056).
   */
  getExercise(id: string): ContentExercise | null {
    if (id.includes('@')) return this.#variant(id);
    const row = this.#db.select().from(t.exercises).where(eq(t.exercises.id, id)).get();
    if (!row) return null;
    return this.#toExercise(row, this.#exerciseConcepts([id]).get(id) ?? []);
  }

  getExercises(ids: readonly string[]): ContentExercise[] {
    if (ids.length === 0) return [];
    const variants = ids
      .filter((id) => id.includes('@'))
      .map((id) => this.#variant(id))
      .filter((e) => e !== null);
    const authored = ids.filter((id) => !id.includes('@'));
    if (authored.length === 0) return variants;
    const rows = this.#db
      .select()
      .from(t.exercises)
      .where(inArray(t.exercises.id, authored))
      .all();
    const concepts = this.#exerciseConcepts(rows.map((r) => r.id));
    return [...rows.map((r) => this.#toExercise(r, concepts.get(r.id) ?? [])), ...variants];
  }

  /** Every template with its verified pool, keyed by ID (loaded once; content.db is read-only). */
  #templateIndex(): Map<string, ContentTemplate> {
    if (this.#templates) return this.#templates;
    const pools = new Map<string, TemplatePoolEntry[]>();
    for (const row of this.#db
      .select({
        templateId: t.templateVariants.templateId,
        variantId: t.templateVariants.variantId,
        sampleIndex: t.templateVariants.sampleIndex,
        answerKey: t.templateVariants.answerKey,
      })
      .from(t.templateVariants)
      .orderBy(asc(t.templateVariants.templateId), asc(t.templateVariants.sampleIndex))
      .all()) {
      const list = pools.get(row.templateId) ?? [];
      list.push({ variantId: row.variantId, sampleIndex: row.sampleIndex, answerKey: row.answerKey });
      pools.set(row.templateId, list);
    }
    this.#templates = new Map(
      this.#db
        .select({
          id: t.exerciseTemplates.id,
          type: t.exerciseTemplates.type,
          difficulty: t.exerciseTemplates.difficulty,
          lessonId: t.exerciseTemplates.lessonId,
          usage: t.exerciseTemplates.usage,
          primaryConceptId: t.exerciseTemplates.primaryConceptId,
          minDistinctFromRecent: t.exerciseTemplates.minDistinctFromRecent,
        })
        .from(t.exerciseTemplates)
        .orderBy(asc(t.exerciseTemplates.id))
        .all()
        .map((row) => [row.id, { ...row, pool: pools.get(row.id) ?? [] }]),
    );
    return this.#templates;
  }

  /**
   * Templates (with a non-empty pool) whose primary concept is one of `conceptIds` or whose home
   * lesson is `lessonId`, of the given usages. Variant selection is the caller's
   * (services/practice/templates.ts).
   */
  listTemplates(filter: {
    conceptIds?: readonly string[];
    lessonId?: string;
    usages: readonly ContentTemplate['usage'][];
  }): ContentTemplate[] {
    const concepts = new Set(filter.conceptIds ?? []);
    return [...this.#templateIndex().values()].filter(
      (tpl) =>
        tpl.pool.length > 0 &&
        filter.usages.includes(tpl.usage) &&
        (concepts.has(tpl.primaryConceptId) || tpl.lessonId === filter.lessonId),
    );
  }

  /**
   * Instantiates `<template id>@<seed>` with exercise-kit's engine (deterministic: the same ID
   * always yields the same variant) and fills the execution-derived answer key recorded at build
   * time. Seeds outside the verified pool are not served (null): their answers were never run.
   */
  #variant(id: string): ContentExercise | null {
    const cached = this.#variants.get(id);
    if (cached !== undefined) return cached;
    const resolved = this.#resolveVariant(id);
    this.#variants.set(id, resolved);
    return resolved;
  }

  #resolveVariant(id: string): ContentExercise | null {
    const parsed = parseVariantId(id);
    if (!parsed) return null;
    const pooled = this.#db
      .select()
      .from(t.templateVariants)
      .where(eq(t.templateVariants.variantId, id))
      .get();
    if (pooled?.templateId !== parsed.templateId) return null;
    const row = this.#db
      .select()
      .from(t.exerciseTemplates)
      .where(eq(t.exerciseTemplates.id, parsed.templateId))
      .get();
    if (!row) return null;
    const instance = instantiateVariant(row.template, id);
    const spec = { ...(instance.spec as Record<string, unknown>) };
    if (pooled.expected !== null) spec['expected'] = pooled.expected;
    const levels = instance.hints ?? [];
    return {
      id,
      type: row.type,
      difficulty: row.difficulty,
      lessonId: row.lessonId,
      usage: row.usage,
      // Explicit, so every consumer computes the same group key (the template ID by default).
      variantGroup: row.variantGroup ?? row.id,
      prompt: instance.render['prompt'] ?? '',
      code: instance.render['code'] ?? null,
      spec,
      hints: { v: 1, levels },
      explanation: instance.explanation ?? '',
      estimatedSeconds: row.estimatedSeconds,
      origin: 'template',
      contentHash: pooled.contentHash,
      concepts: [...row.concepts].sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.conceptId.localeCompare(b.conceptId),
      ),
      misconceptionIds: row.misconceptionIds,
      workedExampleStage: null,
      leakFingerprints: leakFingerprints(row.type, spec),
    };
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
      .all()
      // Interleaved items of other units, but never another project unit's preparation items.
      .filter((r) => r.lessonId === lessonId || !this.#inProject(r.lessonId));
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
      .all()
      .filter((r) => !this.#inProject(r.lessonId));
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

  /**
   * The milestone `web_task` of a `kind: project` unit (its only `usage: project` exercise), or
   * null for other lessons.
   */
  getProjectExercise(lessonId: string): ContentExercise | null {
    const row = this.#db
      .select()
      .from(t.exercises)
      .where(and(eq(t.exercises.lessonId, lessonId), eq(t.exercises.usage, 'project')))
      .orderBy(asc(t.exercises.id))
      .get();
    if (!row) return null;
    return this.#toExercise(row, this.#exerciseConcepts([row.id]).get(row.id) ?? []);
  }

  /** `usage: practice` exercises of a lesson (a project unit's preparation practice). */
  countPracticeExercises(lessonId: string): number {
    return (
      this.#db
        .select({ n: count() })
        .from(t.exercises)
        .where(and(eq(t.exercises.lessonId, lessonId), eq(t.exercises.usage, 'practice')))
        .get()?.n ?? 0
    );
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
      kind: lesson.kind,
      importance: lesson.importance,
      passRule: lesson.passRule ?? {},
      introduces: roles.filter((r) => r.role === 'introduces').map((r) => r.conceptId),
      practices: roles.filter((r) => r.role === 'practices').map((r) => r.conceptId),
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
   * Concepts with their summary and the lesson that introduces them (`introduced_in_lesson_id`),
   * for the lesson prerequisite list (FR-CUR-02).
   */
  getConceptsWithLesson(
    ids: readonly string[],
  ): Map<string, { id: string; title: string; summary: string; lesson: { id: string; title: string } | null }> {
    const out = new Map<
      string,
      { id: string; title: string; summary: string; lesson: { id: string; title: string } | null }
    >();
    if (ids.length === 0) return out;
    for (const row of this.#db
      .select({
        id: t.concepts.id,
        title: t.concepts.title,
        summary: t.concepts.summary,
        lessonId: t.lessons.id,
        lessonTitle: t.lessons.title,
      })
      .from(t.concepts)
      .leftJoin(t.lessons, eq(t.concepts.introducedInLessonId, t.lessons.id))
      .where(inArray(t.concepts.id, [...new Set(ids)]))
      .all()) {
      out.set(row.id, {
        id: row.id,
        title: row.title,
        summary: row.summary,
        lesson:
          row.lessonId !== null && row.lessonTitle !== null
            ? { id: row.lessonId, title: row.lessonTitle }
            : null,
      });
    }
    return out;
  }

  /**
   * Lessons of a course in reading order with their time estimates (pace and today's plan).
   * By default only `kind: lesson` units: the pace leaves assessments and projects out
   * (learning-engine.md#목표-페이스-계산-computepace); today's plan also takes projects.
   */
  listCourseLessons(
    courseId: string,
    kinds: readonly LessonKind[] = ['lesson'],
  ): CourseLessonEstimate[] {
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
      .filter((l) => kinds.includes(l.kind))
      .map((l) => ({ ...l, courseId }));
  }

  /** Time estimates of the given lessons (any course; unknown IDs are left out). */
  getLessonEstimates(ids: readonly string[]): Map<string, { kind: LessonKind; estimatedMinutes: number }> {
    if (ids.length === 0) return new Map();
    return new Map(
      this.#db
        .select({
          id: t.lessons.id,
          kind: t.lessons.kind,
          estimatedMinutes: t.lessons.estimatedMinutes,
        })
        .from(t.lessons)
        .where(inArray(t.lessons.id, [...ids]))
        .all()
        .map((l) => [l.id, { kind: l.kind, estimatedMinutes: l.estimatedMinutes }]),
    );
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

  /**
   * IDs of a lesson's editable `<RunnableExample>`s (runnable `js`/`html`/`web`, not
   * `editable={false}`), or null for an unknown lesson. Example drafts are kept only for these.
   */
  lessonEditableExampleIds(id: string): Set<string> | null {
    const lesson = this.#db
      .select({ body: t.lessons.bodyCompiled })
      .from(t.lessons)
      .where(eq(t.lessons.id, id))
      .get();
    if (!lesson) return null;
    const out = new Set<string>();
    const visit = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) {
        for (const c of n) visit(c);
        return;
      }
      const node = n as { type?: unknown; name?: unknown; props?: unknown; children?: unknown };
      if (node.type === 'component' && node.name === 'RunnableExample') {
        const p = (node.props ?? {}) as { id?: unknown; lang?: unknown; editable?: unknown };
        if (
          typeof p.id === 'string' &&
          (p.lang === 'js' || p.lang === 'html' || p.lang === 'web') &&
          p.editable !== false
        )
          out.add(p.id);
      }
      visit(node.children);
    };
    visit(lesson.body);
    return out;
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
    const project = lesson.kind === 'project' ? this.getProjectExercise(lesson.id) : null;
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
      practiceCount: this.countPracticeExercises(lesson.id),
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
      project: project && {
        exerciseId: project.id,
        milestoneCount: projectMilestones(project.spec).length,
        practiceCount: this.countPracticeExercises(lesson.id),
        estimatedMinutes: lesson.estimatedMinutes - lesson.readMinutes,
      },
    };
  }
}

/** Milestones of a project `web_task` spec (exercise-kit validated it at build time). */
export function projectMilestones(
  spec: Record<string, unknown>,
): { id: string; title: string; checks: string[] }[] {
  const raw = spec['milestones'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m: unknown) => {
    if (!m || typeof m !== 'object') return [];
    const { id, title, checks } = m as { id?: unknown; title?: unknown; checks?: unknown };
    if (typeof id !== 'string' || typeof title !== 'string' || !Array.isArray(checks)) return [];
    return [{ id, title, checks: checks.filter((c): c is string => typeof c === 'string') }];
  });
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
