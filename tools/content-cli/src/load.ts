import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  conceptsFileSchema,
  courseSchema,
  exerciseSourceSchema,
  lessonSchema,
  misconceptionsFileSchema,
  moduleSchema,
  packSchema,
  templateSourceSchema,
  type ConceptSource,
  type CourseSource,
  type ExerciseSource,
  type LessonSource,
  type MisconceptionSource,
  type ModuleSource,
  type Pack,
  type TemplateSource,
} from '@proginone/content-schema';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import type { Diagnostics } from './diagnostics.ts';

export interface Located<T> {
  file: string;
  data: T;
}

export interface LessonNodeSource {
  dir: string;
  localSlug: string;
  meta: Located<LessonSource>;
  mdxFile: string;
  mdx: string | null;
  exercises: Located<ExerciseSource>[];
  /** Parametric templates (`templates/*.yaml`). */
  templates: Located<TemplateSource>[];
}

export interface ModuleNodeSource {
  dir: string;
  localSlug: string;
  meta: Located<ModuleSource>;
  lessons: LessonNodeSource[];
}

export interface CourseNodeSource {
  dir: string;
  meta: Located<CourseSource>;
  modules: ModuleNodeSource[];
}

export interface ContentSource {
  root: string;
  pack: Located<Pack> | null;
  concepts: Located<ConceptSource>[];
  misconceptions: Located<MisconceptionSource>[];
  courses: CourseNodeSource[];
}

/** `06-functions` → `functions`. Directory number prefixes are for sorting only. */
const stripOrder = (name: string) => name.replace(/^\d+-/, '');

const subdirs = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => statSync(join(dir, n)).isDirectory())
        .sort()
    : [];

function readYaml<S extends z.ZodType>(
  file: string,
  schema: S,
  diag: Diagnostics,
): z.output<S> | null {
  if (!existsSync(file)) {
    diag.error(file, '파일이 없습니다');
    return null;
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(file, 'utf8'));
  } catch (e) {
    diag.error(file, `YAML을 해석할 수 없습니다: ${(e as Error).message}`);
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    diag.zod(file, parsed.error);
    return null;
  }
  return parsed.data;
}

function readList<T>(dir: string, schema: z.ZodType<T[]>, diag: Diagnostics): Located<T>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .flatMap((f) => {
      const file = join(dir, f);
      return (readYaml(file, schema, diag) ?? []).map((data) => ({ file, data }));
    });
}

/** One schema-validated item per `*.yaml` file of a directory (sorted by file name). */
function readEach<S extends z.ZodType>(
  dir: string,
  schema: S,
  diag: Diagnostics,
): Located<z.output<S>>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .flatMap((f) => {
      const file = join(dir, f);
      const data = readYaml(file, schema, diag);
      return data ? [{ file, data }] : [];
    });
}

/**
 * Reads the content directory (docs/design/content-and-exercises.md#디렉터리-구조) and validates
 * each file against its schema. Structural problems become diagnostics; valid parts are returned.
 */
export function loadContent(root: string, diag: Diagnostics): ContentSource {
  const packFile = join(root, 'pack.yaml');
  const pack = readYaml(packFile, packSchema, diag);
  const source: ContentSource = {
    root,
    pack: pack ? { file: packFile, data: pack } : null,
    concepts: readList(join(root, 'concepts'), conceptsFileSchema, diag),
    misconceptions: readList(join(root, 'misconceptions'), misconceptionsFileSchema, diag),
    courses: [],
  };
  if (!pack) return source;

  const packCourses = pack.tracks.flatMap((t) => t.courses);
  for (const courseSlug of packCourses) {
    const dir = join(root, 'courses', courseSlug);
    const file = join(dir, 'course.yaml');
    const course = readYaml(file, courseSchema, diag);
    if (!course) continue;
    if (course.id !== courseSlug)
      diag.error(file, `id(${course.id})가 디렉터리 이름(${courseSlug})과 다릅니다`);
    source.courses.push({
      dir,
      meta: { file, data: course },
      modules: loadModules(dir, course, diag),
    });
  }
  return source;
}

function ordered<T extends { localSlug: string }>(
  items: T[],
  order: readonly string[],
  file: string,
  what: string,
  diag: Diagnostics,
): T[] {
  for (const slug of order) {
    if (!items.some((i) => i.localSlug === slug))
      diag.error(file, `${what} "${slug}"의 디렉터리가 없습니다`);
  }
  for (const item of items) {
    if (!order.includes(item.localSlug))
      diag.error(file, `목록에 없는 ${what} 디렉터리입니다: ${item.localSlug}`);
  }
  const listed = order.filter((s) => items.some((i) => i.localSlug === s));
  const onDisk = items.map((i) => i.localSlug).filter((s) => order.includes(s));
  if (listed.join() !== onDisk.join())
    diag.warn(file, `${what} 디렉터리 번호 순서가 목록 순서와 다릅니다`);
  return listed
    .map((s) => items.find((i) => i.localSlug === s))
    .filter((x): x is T => x !== undefined);
}

function loadModules(
  courseDir: string,
  course: CourseSource,
  diag: Diagnostics,
): ModuleNodeSource[] {
  const modulesDir = join(courseDir, 'modules');
  const modules: ModuleNodeSource[] = [];
  for (const name of subdirs(modulesDir)) {
    const dir = join(modulesDir, name);
    const file = join(dir, 'module.yaml');
    const meta = readYaml(file, moduleSchema, diag);
    if (!meta) continue;
    const localSlug = stripOrder(name);
    if (meta.id !== `${course.id}.${localSlug}`) {
      diag.error(file, `id는 "${course.id}.${localSlug}"여야 합니다(현재 ${meta.id})`);
    }
    modules.push({
      dir,
      localSlug,
      meta: { file, data: meta },
      lessons: loadLessons(dir, meta, diag),
    });
  }
  return ordered(modules, course.modules, join(courseDir, 'course.yaml'), '모듈', diag);
}

function loadLessons(moduleDir: string, mod: ModuleSource, diag: Diagnostics): LessonNodeSource[] {
  const lessonsDir = join(moduleDir, 'lessons');
  const lessons: LessonNodeSource[] = [];
  for (const name of subdirs(lessonsDir)) {
    const dir = join(lessonsDir, name);
    const file = join(dir, 'lesson.yaml');
    const meta = readYaml(file, lessonSchema, diag);
    if (!meta) continue;
    const localSlug = stripOrder(name);
    if (meta.id !== `${mod.id}.${localSlug}`)
      diag.error(file, `id는 "${mod.id}.${localSlug}"여야 합니다(현재 ${meta.id})`);
    const mdxFile = join(dir, 'lesson.mdx');
    const mdx = existsSync(mdxFile) ? readFileSync(mdxFile, 'utf8') : null;
    if (mdx === null) diag.error(mdxFile, '레슨 본문 파일이 없습니다');
    const exercises = readEach(join(dir, 'exercises'), exerciseSourceSchema, diag);
    const templates = readEach(join(dir, 'templates'), templateSourceSchema, diag);
    lessons.push({
      dir,
      localSlug,
      meta: { file, data: meta },
      mdxFile,
      mdx,
      exercises,
      templates,
    });
  }
  return ordered(lessons, mod.lessons, join(moduleDir, 'module.yaml'), '단원', diag);
}

export const lessonDirName = (dir: string) => basename(dir);
