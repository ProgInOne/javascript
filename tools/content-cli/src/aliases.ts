/**
 * FR-CUR-06: slug aliases and the published-slug manifest
 * (content-and-exercises.md#slug-변경과-alias, data-model.md `content_id_aliases`).
 *
 * - `content/aliases.yaml` maps old slugs to current ones. `checkAliases` validates it against the
 *   loaded content and returns the `content_id_aliases` rows `build` writes.
 * - `content/.published-slugs.txt` lists every slug the last release build published. A slug in
 *   it that is gone from the content and has no alias is warned about: learners' records would
 *   lose their history (D-057). `content-cli build` rewrites the list (release builds only).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aliasesFileSchema,
  aliasTargets,
  conceptId,
  courseId,
  exerciseId,
  lessonId,
  misconceptionId,
  moduleId,
  type AliasEntry,
  type AliasKind,
  type ContentEntityKind,
} from '@proginone/content-schema';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import type { Diagnostics } from './diagnostics.ts';
import type { ContentSource } from './load.ts';

export const ALIASES_FILE = 'aliases.yaml';
export const PUBLISHED_SLUGS_FILE = '.published-slugs.txt';

/** A `content_id_aliases` row (packages/content-schema/src/db/ddl.ts). */
export interface AliasRow {
  old_id: string;
  new_id: string;
  alias_kind: AliasKind;
  is_primary: 0 | 1;
  entity_kind: ContentEntityKind;
  since_pack_version: string;
}

interface ContentId {
  kind: ContentEntityKind;
  /** Whether a release build ships it (draft exercises do not). */
  published: boolean;
}

/** Every slug of the loaded content with its kind. */
export function contentIds(source: ContentSource): Map<string, ContentId> {
  const ids = new Map<string, ContentId>();
  const add = (id: string, kind: ContentEntityKind, published = true) => {
    if (!ids.has(id)) ids.set(id, { kind, published });
  };
  for (const course of source.courses) {
    add(course.meta.data.id, 'course');
    for (const mod of course.modules) {
      add(mod.meta.data.id, 'module');
      for (const lesson of mod.lessons) {
        add(lesson.meta.data.id, 'lesson');
        for (const { data: ex } of lesson.exercises)
          add(ex.id, 'exercise', ex.review.status === 'approved');
      }
    }
  }
  // Concepts ship only when a unit introduces them (build.ts skips the others).
  const introduced = new Set(
    source.courses.flatMap((c) =>
      c.modules.flatMap((m) => m.lessons.flatMap((l) => l.meta.data.concepts.primary)),
    ),
  );
  for (const { data: c } of source.concepts) add(c.id, 'concept', introduced.has(c.id));
  for (const { data: m } of source.misconceptions) add(m.id, 'misconception');
  return ids;
}

/** Slug shape of each kind: an old slug must look like what replaces it. */
const SHAPES: Record<ContentEntityKind, z.ZodType<string>> = {
  course: courseId,
  module: moduleId,
  lesson: lessonId,
  concept: conceptId,
  misconception: misconceptionId,
  exercise: exerciseId,
};

const KIND_LABELS: Record<ContentEntityKind, string> = {
  course: '과정',
  module: '모듈',
  lesson: '단원',
  concept: '개념',
  misconception: '오개념',
  exercise: '문제',
};

function readAliases(root: string, diag: Diagnostics): AliasEntry[] {
  const file = join(root, ALIASES_FILE);
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf8')) ?? [];
  } catch (e) {
    diag.error(file, `YAML을 해석할 수 없습니다: ${(e as Error).message}`);
    return [];
  }
  const parsed = aliasesFileSchema.safeParse(raw);
  if (!parsed.success) {
    diag.zod(file, parsed.error);
    return [];
  }
  return parsed.data;
}

/**
 * Validates `aliases.yaml` against the content and returns its `content_id_aliases` rows. Then
 * compares the content with `.published-slugs.txt` (when present) and warns about published slugs
 * that disappeared without an alias.
 */
export function checkAliases(source: ContentSource, diag: Diagnostics): AliasRow[] {
  const file = join(source.root, ALIASES_FILE);
  const ids = contentIds(source);
  const since = source.pack?.data.version ?? '';
  const rows: AliasRow[] = [];
  const seen = new Set<string>();
  const mergeTargets = new Map<string, number>();

  for (const a of readAliases(source.root, diag)) {
    const where = a.from;
    if (seen.has(a.from)) {
      diag.error(file, `${where}: 같은 from이 두 번 있습니다`);
      continue;
    }
    seen.add(a.from);
    const current = ids.get(a.from);
    if (current) {
      diag.error(
        file,
        `${where}: 이전 slug가 아직 콘텐츠에 있습니다(${KIND_LABELS[current.kind]}). 별칭은 사라진 slug에만 씁니다`,
      );
      continue;
    }
    const targets = aliasTargets(a);
    const kinds = new Set<ContentEntityKind>();
    let ok = true;
    for (const to of targets) {
      const target = ids.get(to);
      if (!target) {
        diag.error(
          file,
          `${where}: 없는 slug를 가리킵니다: ${to} (별칭은 현재 slug를 가리켜야 합니다. 이전 별칭을 고칠 때는 최종 slug로 바꾸세요)`,
        );
        ok = false;
        continue;
      }
      kinds.add(target.kind);
      if (!target.published)
        diag.warn(
          file,
          `${where}: ${to}은(는) 아직 공개되지 않습니다(미검토 문제 또는 소개되지 않은 개념)`,
        );
    }
    if (!ok) continue;
    const [kind, ...others] = [...kinds];
    if (!kind || others.length > 0) {
      diag.error(file, `${where}: to의 slug 종류가 서로 다릅니다(${[...kinds].join(', ')})`);
      continue;
    }
    if (!SHAPES[kind].safeParse(a.from).success) {
      diag.error(file, `${where}: from이 ${KIND_LABELS[kind]} slug 형식이 아닙니다`);
      continue;
    }
    if (a.kind === 'merge') {
      const to = targets[0] ?? '';
      mergeTargets.set(to, (mergeTargets.get(to) ?? 0) + 1);
    }
    for (const to of targets) {
      rows.push({
        old_id: a.from,
        new_id: to,
        alias_kind: a.kind,
        is_primary: a.kind !== 'split' || a.primary === to ? 1 : 0,
        entity_kind: kind,
        since_pack_version: a.since ?? since,
      });
    }
  }
  for (const [to, n] of mergeTargets) {
    if (n === 1)
      diag.warn(file, `${to}: merge 항목이 하나뿐입니다. 이름만 바뀌었다면 kind: rename을 쓰세요`);
  }

  checkDisappeared(source, ids, new Set(rows.map((r) => r.old_id)), diag);
  return rows;
}

/** Published slugs of the content, as `<kind> <id>` manifest lines. */
export function publishedSlugLines(source: ContentSource): string[] {
  return [...contentIds(source)]
    .filter(([, v]) => v.published)
    .map(([id, v]) => `${v.kind} ${id}`)
    .sort();
}

const HEADER = [
  '# 공개한 콘텐츠 slug 목록. content-cli build가 갱신합니다(직접 고치지 않습니다).',
  '# 여기 있던 slug가 콘텐츠에서 사라지면 content-cli check가 경고합니다. aliases.yaml에',
  '# 새 slug를 기록하거나, 의도한 삭제라면 pnpm content:build로 이 파일을 갱신해 커밋하세요.',
];

/** Reads the manifest: id → kind, or null when there is none yet. */
export function readPublishedSlugs(root: string): Map<string, string> | null {
  const file = join(root, PUBLISHED_SLUGS_FILE);
  if (!existsSync(file)) return null;
  const out = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const [kind = '', id = ''] = t.split(/\s+/);
    if (id) out.set(id, kind);
  }
  return out;
}

/** Writes the manifest; returns whether its content changed. */
export function writePublishedSlugs(source: ContentSource): boolean {
  const file = join(source.root, PUBLISHED_SLUGS_FILE);
  const text = [...HEADER, ...publishedSlugLines(source)].join('\n') + '\n';
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  writeFileSync(file, text);
  return true;
}

function checkDisappeared(
  source: ContentSource,
  ids: Map<string, ContentId>,
  aliased: Set<string>,
  diag: Diagnostics,
): void {
  const previous = readPublishedSlugs(source.root);
  if (!previous) return;
  const file = join(source.root, PUBLISHED_SLUGS_FILE);
  for (const [id, kind] of previous) {
    if (aliased.has(id)) continue;
    const now = ids.get(id);
    if (now?.published) continue;
    const label = (KIND_LABELS as Partial<Record<string, string>>)[kind] ?? kind;
    diag.warn(
      file,
      now
        ? `공개했던 ${label} ${id}이(가) 미검토 상태로 돌아가 빌드에서 빠집니다. 학습 기록은 "보관됨"이 됩니다`
        : `공개했던 ${label} ${id}이(가) 사라졌습니다. 이름을 바꿨다면 aliases.yaml에 기록하고, 의도한 삭제라면 pnpm content:build로 목록을 갱신하세요`,
    );
  }
}
