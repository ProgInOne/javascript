import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  DEFAULT_ASSESSMENT_PASS_RATIO,
  type ConceptSource,
  type ExerciseSource,
} from '@proginone/content-schema';
import { CONTENT_DB_SCHEMA_VERSION, CONTENT_DDL } from '@proginone/content-schema/db';
import Database from 'better-sqlite3';
import { writePublishedSlugs } from './aliases.ts';
import { checkContent, projectExerciseOf, type SpecValidator } from './check.ts';
import type { Diagnostics } from './diagnostics.ts';
import { canonical, sha256 } from './hash.ts';
import {
  engineTemplateOf,
  hasValue,
  templateHash,
  variantAnswerKey,
  variantContentHash,
  type CheckedTemplate,
} from './templates.ts';

/** Type-specific operations supplied by exercise-kit. */
export interface ExerciseKitHooks {
  validateSpec: SpecValidator;
  /** Public spec without answer keys (sent to the client). */
  redact: (type: string, spec: Record<string, unknown>) => Record<string, unknown>;
  /** Normalized answer fingerprints for AI hint leak checks (server only). */
  leakFingerprints: (type: string, spec: Record<string, unknown>) => string[];
}

export interface BuildOptions {
  kit: ExerciseKitHooks;
  now?: Date;
  sourceCommit?: string | null;
  /**
   * Development only: also include `review.status: draft` exercises so the app has content
   * before human review. Never use for a release build (D-004: only approved content ships).
   */
  includeDrafts?: boolean;
  /** Also run the quantity rules (`CheckOptions.quantity`). */
  quantity?: boolean;
  /**
   * Rewrite `<root>/.published-slugs.txt` after a successful build (aliases.ts). The CLI does
   * this for release builds; never with `includeDrafts`.
   */
  updatePublishedSlugs?: boolean;
}

export interface BuildResult {
  diagnostics: Diagnostics;
  written: boolean;
  stats: {
    courses: number;
    lessons: number;
    concepts: number;
    exercises: number;
    skippedDrafts: number;
    /** Draft exercises written because of `includeDrafts`. */
    includedDrafts: number;
    /** Templates written, and the verified variants in their pools. */
    templates: number;
    templateVariants: number;
  };
}

function sourceHash(root: string): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(root);
  const h = createHash('sha256');
  for (const f of files)
    h.update(relative(root, f)).update('\0').update(readFileSync(f)).update('\0');
  return h.digest('hex');
}

/** Normalized structure signature for duplicate detection (full acorn fingerprints come later). */
const dedupeSignature = (ex: ExerciseSource) => {
  const primary = ex.concepts.find((c) => c.weight === 1)?.id ?? '';
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return `${ex.type}|${primary}|${sha256(norm(ex.prompt) + '\n' + norm(ex.code ?? ''))}`;
};

const mdnUrl = (path: string | undefined) =>
  path ? `https://developer.mozilla.org/ko/docs/${path}` : null;
const prereqOf = (p: ConceptSource['prerequisites'][number]) =>
  typeof p === 'string' ? { id: p, strength: 'required' as const } : p;

/**
 * Writes a template and its verified variant pool (D-056). Only variants the last `check --run`
 * verified are stored (predict ones with their execution-derived answer key); the server serves
 * nothing else. Drafts follow the exercise rule (`includeDrafts` only).
 */
function insertTemplate(
  tpl: CheckedTemplate,
  ctx: {
    insert: (table: string, row: Record<string, unknown>) => void;
    diagnostics: Diagnostics;
    includeDrafts: boolean;
    stats: BuildResult['stats'];
  },
): void {
  const { source: t } = tpl;
  const isDraft = t.review.status !== 'approved';
  if (isDraft && !ctx.includeDrafts) {
    ctx.stats.skippedDrafts++;
    return;
  }
  const pool = tpl.variants.filter((v) => v.verified);
  if (pool.length === 0) {
    ctx.diagnostics.warn(
      tpl.file,
      '실행 검증된 변형이 없어 빌드에서 뺐습니다. pnpm content:check:run으로 검증하세요',
    );
    return;
  }
  if (isDraft) ctx.stats.includedDrafts++;
  const primary = t.concepts.find((c) => c.weight === 1)?.id ?? '';
  const space = tpl.spaceSize;
  const hint = Math.min(
    Number.isFinite(space) ? space : 1_000_000,
    t.variantPolicy.maxVariants ?? 1_000_000,
  );
  ctx.insert('exercise_templates', {
    id: t.id,
    type: t.type,
    difficulty: t.difficulty,
    lesson_id: tpl.lessonId,
    usage: t.usage,
    variant_group: t.variantGroup,
    primary_concept_id: primary,
    concepts_json: JSON.stringify(
      t.concepts.map((c) => ({ conceptId: c.id, weight: c.weight, isPrimary: c.weight === 1 })),
    ),
    template_json: JSON.stringify(engineTemplateOf(t)),
    misconception_ids_json: JSON.stringify(t.misconceptions),
    tags_json: JSON.stringify(t.tags),
    estimated_seconds: t.estimatedSeconds,
    variant_count_hint: hint,
    min_distinct_from_recent: t.variantPolicy.minDistinctFromRecent,
    review_status: isDraft ? 'auto_verified' : 'trusted',
    template_hash: templateHash(t),
  });
  for (const v of pool) {
    ctx.insert('template_variants', {
      variant_id: v.variantId,
      template_id: t.id,
      seed: v.seed,
      sample_index: v.sampleIndex,
      expected_json: hasValue(v.spec['expected']) ? JSON.stringify(v.spec['expected']) : null,
      answer_key: variantAnswerKey(t, v),
      content_hash: variantContentHash(t, v),
    });
  }
  ctx.stats.templates++;
  ctx.stats.templateVariants += pool.length;
}

/**
 * `content-cli build`: check, then write a fresh content.db atomically (temp file + rename).
 * Nothing is written when the check reports errors. Draft exercises are excluded unless
 * `includeDrafts` (development builds) is set; they are then stored like approved ones and the
 * pack records `includes_drafts: 1` in content_meta so a dev database is recognizable.
 */
export function buildContent(root: string, outFile: string, options: BuildOptions): BuildResult {
  const { kit, now = new Date(), sourceCommit = null, includeDrafts = false } = options;
  const {
    source,
    diagnostics,
    lessons: compiled,
    aliases,
    templates,
  } = checkContent(root, { validateSpec: kit.validateSpec, quantity: options.quantity ?? false });
  const stats = {
    courses: 0,
    lessons: 0,
    concepts: 0,
    exercises: 0,
    skippedDrafts: 0,
    includedDrafts: 0,
    templates: 0,
    templateVariants: 0,
  };
  if (diagnostics.errorCount > 0 || !source.pack) return { diagnostics, written: false, stats };
  const pack = source.pack.data;

  mkdirSync(dirname(outFile), { recursive: true });
  const tmp = `${outFile}.partial`;
  rmSync(tmp, { force: true });
  const db = new Database(tmp);
  try {
    db.pragma('journal_mode = DELETE');
    db.exec(CONTENT_DDL);
    const insert = (table: string, row: Record<string, unknown>) => {
      const cols = Object.keys(row);
      db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
      ).run(row);
    };
    const search = (entity_id: string, kind: string, title: string, body: string) => {
      insert('content_search', { entity_id, kind, title, body });
    };

    db.transaction(() => {
      const lessonOfConcept = new Map<string, { lessonId: string; courseId: string }>();
      for (const course of source.courses) {
        for (const mod of course.modules) {
          for (const lesson of mod.lessons) {
            for (const c of lesson.meta.data.concepts.primary) {
              lessonOfConcept.set(c, {
                lessonId: lesson.meta.data.id,
                courseId: course.meta.data.id,
              });
            }
          }
        }
      }

      pack.tracks.forEach((track, ti) => {
        insert('tracks', {
          id: track.id,
          title: track.title,
          summary: track.summary,
          order_index: ti,
        });
      });

      for (const course of source.courses) {
        const c = course.meta.data;
        const trackIndex = pack.tracks.findIndex((t) => t.courses.includes(c.id));
        const track = pack.tracks[trackIndex];
        if (!track) continue;
        const minutes = course.modules
          .flatMap((m) => m.lessons)
          .reduce(
            (sum, l) =>
              sum + l.meta.data.estimatedMinutes.read + l.meta.data.estimatedMinutes.practice,
            0,
          );
        insert('courses', {
          id: c.id,
          track_id: track.id,
          title: c.title,
          summary: c.summary,
          language: c.language,
          level: c.level,
          depth: c.depth,
          order_index: track.courses.indexOf(c.id),
          estimated_minutes: minutes,
          status: c.status,
          objectives_json: JSON.stringify(c.objectives),
        });
        stats.courses++;

        course.modules.forEach((mod, mi) => {
          const m = mod.meta.data;
          // `module.yaml` `assessment`, or the module's `kind: assessment` lesson.
          const assessmentId = m.assessment
            ? `${m.id}.${m.assessment}`
            : (mod.lessons.find((l) => l.meta.data.kind === 'assessment')?.meta.data.id ?? null);
          insert('modules', {
            id: m.id,
            course_id: c.id,
            title: m.title,
            summary: m.summary,
            order_index: mi,
            assessment_id: assessmentId,
            project_id:
              mod.lessons.find((l) => l.meta.data.kind === 'project')?.meta.data.id ?? null,
          });
          mod.lessons.forEach((lesson, li) => {
            const l = lesson.meta.data;
            const body = compiled.get(l.id);
            if (!body) return;
            const bodyJson = JSON.stringify(body.tree);
            insert('lessons', {
              id: l.id,
              module_id: m.id,
              title: l.title,
              summary: l.summary,
              order_index: li,
              importance: l.importance,
              kind: l.kind,
              pass_rule_json: l.practice?.passRule ? JSON.stringify(l.practice.passRule) : null,
              target_count: l.practice?.targetCount ?? null,
              estimated_minutes: l.estimatedMinutes.read + l.estimatedMinutes.practice,
              read_minutes: l.estimatedMinutes.read,
              objectives_json: JSON.stringify(l.objectives),
              body_compiled: bodyJson,
              body_text: body.text,
              sections_json: JSON.stringify({ v: 1, sections: body.sections }),
              content_hash: sha256(bodyJson),
            });
            search(l.id, 'lesson', l.title, `${l.summary} ${body.text}`);
            stats.lessons++;
          });
        });
      }

      for (const { data: c } of source.concepts) {
        const home = lessonOfConcept.get(c.id);
        if (!home) continue;
        insert('concepts', {
          id: c.id,
          course_id: home.courseId,
          title: c.title,
          summary: c.summary,
          importance: c.importance,
          introduced_in_lesson_id: home.lessonId,
          mdn_url: mdnUrl(c.mdn),
        });
        search(c.id, 'concept', c.title, c.summary);
        stats.concepts++;
      }
      for (const { data: c } of source.concepts) {
        for (const p of c.prerequisites.map(prereqOf)) {
          insert('concept_prerequisites', {
            concept_id: c.id,
            prerequisite_id: p.id,
            strength: p.strength,
          });
        }
      }

      for (const course of source.courses) {
        for (const lesson of course.modules.flatMap((m) => m.lessons)) {
          const l = lesson.meta.data;
          const roles = [
            ...l.concepts.primary.map((id) => [id, 'introduces'] as const),
            ...l.concepts.practiced.map((id) => [id, 'practices'] as const),
            ...l.concepts.reviewed.map((id) => [id, 'reviews'] as const),
          ];
          for (const [concept_id, role] of roles)
            insert('lesson_concepts', { lesson_id: l.id, concept_id, role });

          const assessmentItems: string[] = [];
          // A project unit's milestone web_task is stored as `usage: project` even when the YAML
          // leaves it implicit (content-and-exercises.md#프로젝트-단원-kind-project).
          const projectId = projectExerciseOf(lesson)?.exercise.id;
          for (const { data: ex } of lesson.exercises) {
            const isDraft = ex.review.status !== 'approved';
            if (isDraft && !includeDrafts) {
              stats.skippedDrafts++;
              continue;
            }
            if (isDraft) stats.includedDrafts++;
            insert('exercises', {
              id: ex.id,
              type: ex.type,
              difficulty: ex.difficulty,
              lesson_id: l.id,
              usage: ex.id === projectId ? 'project' : ex.usage,
              worked_example_stage: ex.workedExampleStage,
              variant_group: ex.variantGroup,
              prompt: ex.prompt,
              code: ex.code ?? null,
              spec_json: JSON.stringify(ex.spec),
              public_spec_json: JSON.stringify(kit.redact(ex.type, ex.spec)),
              leak_fingerprints_json: JSON.stringify(kit.leakFingerprints(ex.type, ex.spec)),
              hints_json: JSON.stringify({ v: 1, levels: ex.hints }),
              explanation: ex.explanation,
              misconception_ids_json: JSON.stringify(ex.misconceptions),
              tags_json: JSON.stringify(ex.tags),
              estimated_seconds: ex.estimatedSeconds,
              origin: 'authored',
              // Drafts have passed automated checks only; approved ones also passed review by a
              // person or the independent AI reviewer (D-027). Provenance stays in the YAML.
              review_status: isDraft ? 'auto_verified' : 'trusted',
              content_hash: sha256(canonical(ex)),
              dedupe_signature: dedupeSignature(ex),
            });
            for (const c of ex.concepts) {
              insert('exercise_concepts', {
                exercise_id: ex.id,
                concept_id: c.id,
                weight: c.weight,
                is_primary: c.weight === 1 ? 1 : 0,
              });
            }
            search(ex.id, 'exercise', ex.prompt.slice(0, 80), ex.prompt);
            stats.exercises++;
            if (ex.usage === 'assessment') assessmentItems.push(ex.id);
          }
          if (l.kind === 'assessment') {
            insert('assessments', {
              id: l.id,
              scope_type: 'module',
              scope_id: l.id.slice(0, l.id.lastIndexOf('.')),
              title: l.title,
              exercise_ids_json: JSON.stringify(assessmentItems),
              selection_rule_json: JSON.stringify({
                v: 1,
                itemCount: l.assessment?.itemCount ?? null,
                conceptIds: l.concepts.reviewed,
              }),
              pass_ratio: l.assessment?.passRatio ?? DEFAULT_ASSESSMENT_PASS_RATIO,
            });
          }
        }
      }

      for (const row of aliases) insert('content_id_aliases', { ...row });
      for (const tpl of templates) {
        insertTemplate(tpl, { insert, diagnostics, includeDrafts, stats });
      }

      for (const { data: m } of source.misconceptions) {
        insert('misconceptions', {
          id: m.id,
          concept_id: m.concept,
          title: m.title,
          description: m.statement,
          correction: m.reality,
          diagnostic_hint: m.diagnosticHint ?? null,
          remedial_lesson_anchor: m.remediation?.lessonSection ?? null,
          remedial_exercise_ids_json: JSON.stringify(m.remediation?.exercises ?? []),
        });
      }

      const meta: Record<string, string> = {
        pack_id: pack.id,
        pack_version: pack.version,
        schema_version: String(CONTENT_DB_SCHEMA_VERSION),
        built_at: now.toISOString(),
        content_hash: sourceHash(root),
        ...(sourceCommit ? { source_commit: sourceCommit } : {}),
        ...(includeDrafts ? { includes_drafts: '1' } : {}),
      };
      for (const [key, value] of Object.entries(meta)) insert('content_meta', { key, value });
    })();

    const fk = db.pragma('foreign_key_check') as unknown[];
    if (fk.length > 0) throw new Error(`content.db foreign key violations: ${fk.length}`);
    db.close();
    renameSync(tmp, outFile);
    if (options.updatePublishedSlugs && !includeDrafts) writePublishedSlugs(source);
    return { diagnostics, written: true, stats };
  } catch (e) {
    if (db.open) db.close();
    rmSync(tmp, { force: true });
    throw e;
  }
}
