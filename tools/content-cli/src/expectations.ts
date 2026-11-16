import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Diagnostics } from './diagnostics.ts';
import { canonical, sha256 } from './hash.ts';

/**
 * Execution-derived answer keys of `predict_output` exercises
 * (docs/design/content-and-exercises.md#4단계-실행-검증-content-cli-check---run).
 *
 * Authors never write `spec.expected`. `content-cli check --run` runs each exercise in the real
 * runner and records the result here, keyed by exercise ID together with a hash of every spec
 * field that can change the result. `check` and `build` read the file and fill `spec.expected`
 * when the hash still matches, so building content.db needs no browser and stays reproducible,
 * while a code change without a new run is caught as a stale expectation.
 */
export const EXPECTATIONS_FILE = '.generated/predict-expected.json';
/**
 * The same store for template variants, keyed by variant ID (`<template id>@<seed>`) of each
 * build-time sample seed (docs/design/content-and-exercises.md#정답의-실행-계산).
 */
export const TEMPLATE_EXPECTATIONS_FILE = '.generated/template-expected.json';

/** Bump when the hashed inputs or the stored shape change; every entry becomes stale. */
const STORE_VERSION = 1;

const storeSchema = z.object({
  v: z.literal(STORE_VERSION),
  entries: z.record(
    z.string(),
    z.object({ inputHash: z.string().regex(/^[0-9a-f]{64}$/), expected: z.unknown() }),
  ),
});

export interface ExpectationEntry {
  inputHash: string;
  expected: unknown;
}

export interface ExpectationStore {
  v: typeof STORE_VERSION;
  entries: Record<string, ExpectationEntry>;
}

export const emptyStore = (): ExpectationStore => ({ v: STORE_VERSION, entries: {} });

/**
 * Hash of the spec fields that determine the answer key (code, language, asked global,
 * choices). Hints, explanations and misconception maps can change without a new run.
 */
export function predictInputHash(spec: Readonly<Record<string, unknown>>): string {
  return sha256(
    canonical({
      v: STORE_VERSION,
      lang: spec['lang'] ?? 'js',
      code: spec['code'] ?? null,
      answerKind: spec['answerKind'] ?? null,
      expression: spec['expression'] ?? null,
      choices: spec['choices'] ?? null,
    }),
  );
}

/** Reads `<root>/.generated/predict-expected.json` (or `name`). A missing file is an empty store. */
export function readExpectations(
  root: string,
  diag: Diagnostics,
  name: string = EXPECTATIONS_FILE,
): ExpectationStore {
  const file = join(root, name);
  if (!existsSync(file)) return emptyStore();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    diag.error(file, `JSON을 해석할 수 없습니다: ${(e as Error).message}`);
    return emptyStore();
  }
  const parsed = storeSchema.safeParse(raw);
  if (!parsed.success) {
    diag.error(
      file,
      '실행 기대값 파일 형식이 맞지 않습니다. pnpm content:check:run으로 다시 만드세요',
    );
    return emptyStore();
  }
  return parsed.data;
}

/** Stable text form: sorted IDs, two-space indent, trailing newline (diff-friendly). */
export function serializeExpectations(store: ExpectationStore): string {
  const entries = Object.fromEntries(
    Object.entries(store.entries)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, entry]) => [id, { inputHash: entry.inputHash, expected: entry.expected }]),
  );
  return `${JSON.stringify({ v: store.v, entries }, null, 2)}\n`;
}

export function writeExpectations(
  root: string,
  store: ExpectationStore,
  name: string = EXPECTATIONS_FILE,
): string {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeExpectations(store));
  return file;
}
