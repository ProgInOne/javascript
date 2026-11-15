import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Typed read access to content.db. Must mirror ./ddl.ts (verified by ddl.test.ts).

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const contentMeta = sqliteTable('content_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  orderIndex: integer('order_index').notNull(),
});

export const courses = sqliteTable('courses', {
  id: text('id').primaryKey(),
  trackId: text('track_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  language: text('language', { enum: ['html', 'css', 'javascript'] }).notNull(),
  level: text('level', { enum: ['intro', 'basic', 'advanced'] }).notNull(),
  depth: text('depth', { enum: ['full', 'core'] }).notNull(),
  orderIndex: integer('order_index').notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull(),
  status: text('status', { enum: ['published', 'preview', 'hidden'] }).notNull(),
  objectives: json<string[]>('objectives_json').notNull(),
});

export const modules = sqliteTable('modules', {
  id: text('id').primaryKey(),
  courseId: text('course_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  orderIndex: integer('order_index').notNull(),
  assessmentId: text('assessment_id'),
  projectId: text('project_id'),
});

export interface LessonSection {
  id: string;
  kind: string;
  title: string | null;
}

export const lessons = sqliteTable('lessons', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  orderIndex: integer('order_index').notNull(),
  importance: text('importance', { enum: ['core', 'standard', 'minor'] }).notNull(),
  kind: text('kind', { enum: ['lesson', 'assessment', 'project'] }).notNull(),
  passRule: json<Record<string, number>>('pass_rule_json'),
  targetCount: integer('target_count'),
  estimatedMinutes: integer('estimated_minutes').notNull(),
  readMinutes: integer('read_minutes').notNull(),
  objectives: json<string[]>('objectives_json').notNull(),
  /** Validated MDX tree (JSON), rendered by the web app. */
  bodyCompiled: json<unknown[]>('body_compiled').notNull(),
  bodyText: text('body_text').notNull(),
  sections: json<{ v: 1; sections: LessonSection[] }>('sections_json').notNull(),
  contentHash: text('content_hash').notNull(),
});

/** `selection_rule_json` of an assessment. */
export interface AssessmentSelectionRule {
  v: 1;
  /** Items to ask; `null` = every item (up to the engine's maximum). */
  itemCount: number | null;
  /** Concepts the assessment covers (`concepts.reviewed`), in content order. */
  conceptIds: string[];
}

/** Unit assessments. `id` is the `kind: assessment` lesson's ID. */
export const assessments = sqliteTable('assessments', {
  id: text('id').primaryKey(),
  scopeType: text('scope_type', { enum: ['lesson', 'module'] }).notNull(),
  scopeId: text('scope_id').notNull(),
  title: text('title').notNull(),
  exerciseIds: json<string[]>('exercise_ids_json').notNull(),
  selectionRule: json<AssessmentSelectionRule>('selection_rule_json'),
  passRatio: real('pass_ratio').notNull(),
});

export const concepts = sqliteTable('concepts', {
  id: text('id').primaryKey(),
  courseId: text('course_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  importance: text('importance', { enum: ['core', 'standard', 'minor'] }).notNull(),
  introducedInLessonId: text('introduced_in_lesson_id').notNull(),
  mdnUrl: text('mdn_url'),
});

export const conceptPrerequisites = sqliteTable('concept_prerequisites', {
  conceptId: text('concept_id').notNull(),
  prerequisiteId: text('prerequisite_id').notNull(),
  strength: text('strength', { enum: ['required', 'helpful'] }).notNull(),
});

export const lessonConcepts = sqliteTable('lesson_concepts', {
  lessonId: text('lesson_id').notNull(),
  conceptId: text('concept_id').notNull(),
  role: text('role', { enum: ['introduces', 'practices', 'reviews'] }).notNull(),
});

export const misconceptions = sqliteTable('misconceptions', {
  id: text('id').primaryKey(),
  conceptId: text('concept_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  correction: text('correction').notNull(),
  diagnosticHint: text('diagnostic_hint'),
  remedialLessonAnchor: text('remedial_lesson_anchor'),
  remedialExerciseIds: json<string[]>('remedial_exercise_ids_json').notNull(),
});

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  difficulty: integer('difficulty').notNull(),
  lessonId: text('lesson_id'),
  usage: text('usage', {
    enum: ['practice', 'assessment', 'diagnostic', 'remedial', 'worked_example', 'project'],
  }).notNull(),
  workedExampleStage: integer('worked_example_stage'),
  variantGroup: text('variant_group'),
  prompt: text('prompt').notNull(),
  code: text('code'),
  /** Full spec incl. answer keys. Server only. */
  spec: json<Record<string, unknown>>('spec_json').notNull(),
  publicSpec: json<Record<string, unknown>>('public_spec_json').notNull(),
  /** Server only. */
  leakFingerprints: json<string[]>('leak_fingerprints_json').notNull(),
  hints: json<{ v: 1; levels: [string, string, string] }>('hints_json').notNull(),
  explanation: text('explanation').notNull(),
  misconceptionIds: json<string[]>('misconception_ids_json').notNull(),
  tags: json<string[]>('tags_json').notNull(),
  estimatedSeconds: integer('estimated_seconds').notNull(),
  origin: text('origin', { enum: ['authored', 'template'] }).notNull(),
  reviewStatus: text('review_status', { enum: ['auto_verified', 'trusted'] }).notNull(),
  contentHash: text('content_hash').notNull(),
  dedupeSignature: text('dedupe_signature').notNull(),
});

export const exerciseConcepts = sqliteTable('exercise_concepts', {
  exerciseId: text('exercise_id').notNull(),
  conceptId: text('concept_id').notNull(),
  weight: real('weight').notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
});

export const contentIdAliases = sqliteTable('content_id_aliases', {
  oldId: text('old_id').notNull(),
  newId: text('new_id').notNull(),
  aliasKind: text('alias_kind', { enum: ['rename', 'merge', 'split'] }).notNull(),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
  entityKind: text('entity_kind').notNull(),
  sincePackVersion: text('since_pack_version').notNull(),
});
