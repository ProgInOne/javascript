/**
 * content.db DDL (docs/design/data-model.md#contentdb-설계). content.db is rebuilt from scratch
 * on every `content-cli build`, so there are no migrations; bump CONTENT_DB_SCHEMA_VERSION when
 * this changes. The Drizzle tables in ./schema.ts must match (checked by a test).
 */
export const CONTENT_DB_SCHEMA_VERSION = 1;

export const CONTENT_DDL = `
CREATE TABLE content_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  order_index INTEGER NOT NULL UNIQUE
);

CREATE TABLE courses (
  id TEXT PRIMARY KEY NOT NULL,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('html', 'css', 'javascript')),
  level TEXT NOT NULL CHECK (level IN ('intro', 'basic', 'advanced')),
  depth TEXT NOT NULL DEFAULT 'full' CHECK (depth IN ('full', 'core')),
  order_index INTEGER NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'preview', 'hidden')),
  objectives_json TEXT NOT NULL CHECK (json_valid(objectives_json)),
  UNIQUE (track_id, order_index)
);

CREATE TABLE modules (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  assessment_id TEXT,
  project_id TEXT,
  UNIQUE (course_id, order_index)
);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY NOT NULL,
  module_id TEXT NOT NULL REFERENCES modules(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  importance TEXT NOT NULL DEFAULT 'standard' CHECK (importance IN ('core', 'standard', 'minor')),
  kind TEXT NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson', 'assessment', 'project')),
  pass_rule_json TEXT CHECK (pass_rule_json IS NULL OR json_valid(pass_rule_json)),
  target_count INTEGER,
  estimated_minutes INTEGER NOT NULL,
  read_minutes INTEGER NOT NULL,
  objectives_json TEXT NOT NULL CHECK (json_valid(objectives_json)),
  body_compiled TEXT NOT NULL CHECK (json_valid(body_compiled)),
  body_text TEXT NOT NULL,
  sections_json TEXT NOT NULL CHECK (json_valid(sections_json)),
  content_hash TEXT NOT NULL,
  UNIQUE (module_id, order_index)
);

CREATE TABLE concepts (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  importance TEXT NOT NULL DEFAULT 'standard' CHECK (importance IN ('core', 'standard', 'minor')),
  introduced_in_lesson_id TEXT NOT NULL REFERENCES lessons(id),
  mdn_url TEXT
);

CREATE TABLE concept_prerequisites (
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  prerequisite_id TEXT NOT NULL REFERENCES concepts(id),
  strength TEXT NOT NULL DEFAULT 'required' CHECK (strength IN ('required', 'helpful')),
  PRIMARY KEY (concept_id, prerequisite_id),
  CHECK (concept_id <> prerequisite_id)
);
CREATE INDEX concept_prerequisites_reverse ON concept_prerequisites (prerequisite_id);

CREATE TABLE lesson_concepts (
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  role TEXT NOT NULL CHECK (role IN ('introduces', 'practices', 'reviews')),
  PRIMARY KEY (lesson_id, concept_id)
);
CREATE INDEX lesson_concepts_concept ON lesson_concepts (concept_id, role);

CREATE TABLE misconceptions (
  id TEXT PRIMARY KEY NOT NULL,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  correction TEXT NOT NULL,
  diagnostic_hint TEXT,
  remedial_lesson_anchor TEXT,
  remedial_exercise_ids_json TEXT NOT NULL CHECK (json_valid(remedial_exercise_ids_json))
);
CREATE INDEX misconceptions_concept ON misconceptions (concept_id);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  lesson_id TEXT REFERENCES lessons(id),
  usage TEXT NOT NULL DEFAULT 'practice'
    CHECK (usage IN ('practice', 'assessment', 'diagnostic', 'remedial', 'worked_example')),
  worked_example_stage INTEGER CHECK (worked_example_stage IS NULL OR worked_example_stage IN (0, 1, 2)),
  variant_group TEXT,
  prompt TEXT NOT NULL,
  code TEXT,
  spec_json TEXT NOT NULL CHECK (json_valid(spec_json)),
  public_spec_json TEXT NOT NULL CHECK (json_valid(public_spec_json)),
  leak_fingerprints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(leak_fingerprints_json)),
  hints_json TEXT NOT NULL CHECK (json_valid(hints_json)),
  explanation TEXT NOT NULL,
  misconception_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(misconception_ids_json)),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  estimated_seconds INTEGER NOT NULL,
  origin TEXT NOT NULL DEFAULT 'authored' CHECK (origin IN ('authored', 'template')),
  review_status TEXT NOT NULL CHECK (review_status IN ('auto_verified', 'trusted')),
  content_hash TEXT NOT NULL,
  dedupe_signature TEXT NOT NULL
);
CREATE INDEX exercises_lesson ON exercises (lesson_id, usage, difficulty);
CREATE INDEX exercises_type ON exercises (type);
CREATE INDEX exercises_variant_group ON exercises (variant_group);

CREATE TABLE exercise_concepts (
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  weight REAL NOT NULL,
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (exercise_id, concept_id)
);
CREATE INDEX exercise_concepts_concept ON exercise_concepts (concept_id, is_primary);

CREATE TABLE content_id_aliases (
  old_id TEXT NOT NULL,
  new_id TEXT NOT NULL,
  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('rename', 'merge', 'split')),
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  entity_kind TEXT NOT NULL,
  since_pack_version TEXT NOT NULL,
  PRIMARY KEY (old_id, new_id)
);

CREATE VIRTUAL TABLE content_search USING fts5(entity_id UNINDEXED, kind UNINDEXED, title, body, tokenize = 'trigram');
`;
