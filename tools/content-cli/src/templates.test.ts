import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { instantiateVariant, sampleSeeds } from '@proginone/exercise-kit';
import type { RunPlan, RunResult } from '@proginone/run-contract';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildContent } from './build.ts';
import { checkContent } from './check.ts';
import { TEMPLATE_EXPECTATIONS_FILE } from './expectations.ts';
import { exerciseKit } from './kit.ts';
import { runCheck } from './run-check.ts';
import { engineTemplateOf } from './templates.ts';
import { LESSON, writeContent } from './test/fixture.ts';
import type { PlanRunner } from './verify/cases.ts';

const TEMPLATE = `${LESSON}.t.predict-sum`;
const TEMPLATE_YAML =
  'courses/js-basics/modules/01-start/lessons/01-first-program/templates/001-predict-sum.yaml';

type Template = Record<string, unknown>;

function template(overrides: Template = {}): Template {
  return {
    id: TEMPLATE,
    type: 'predict_output',
    difficulty: 2,
    concepts: [{ id: 'js.basics.console-log', weight: 1 }],
    estimatedSeconds: 60,
    params: {
      a: { kind: 'int', min: 1, max: 9 },
      b: { kind: 'int', min: 2, max: 9 },
      c: { kind: 'int', min: 2, max: 5 },
    },
    render: { prompt: '무엇이 출력되나요?' },
    spec: {
      lang: 'js',
      code: 'console.log({{a}} + {{b}} * {{c}});\n',
      answerKind: 'console',
      misconceptionByAnswer: { '{{(a + b) * c}}': 'js.mc.log-is-return' },
    },
    hints: ['`*`가 먼저예요.', '`{{b}} * {{c}}`부터 계산해요.', '그다음 {{a}}를 더해요.'],
    explanation: '`{{b}} * {{c}}`를 먼저 계산해요.',
    misconceptions: ['js.mc.log-is-return'],
    variantPolicy: { sampleSize: 8 },
    review: { status: 'approved', draftedBy: 'ai:claude', reviewedBy: 'ai:reviewer' },
    ...overrides,
  };
}

function content(overrides: Template = {}): string {
  return writeContent((f) => {
    (
      f['courses/js-basics/modules/01-start/lessons/01-first-program/exercises/001-mcq.yaml'] as {
        spec: unknown;
      }
    ).spec = {
      options: [
        { id: 'a', text: '출력' },
        { id: 'b', text: '반환' },
        { id: 'c', text: '저장' },
      ],
      correct: 'a',
    };
    f[TEMPLATE_YAML] = template(overrides);
  });
}

/**
 * Runs JavaScript console programs for real (trusted test code only): `console.log` arguments
 * joined with spaces, one line per call. `drift` makes every run print something new.
 */
function jsRunner(options: { drift?: boolean } = {}): PlanRunner & { runs: number } {
  let runs = 0;
  return {
    get runs() {
      return runs;
    },
    run(plan: RunPlan): Promise<RunResult> {
      runs++;
      const lines: string[] = [];
      const code = plan.files.map((f) => f.content).join('\n');
      const log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
      runInNewContext(code, { console: { log } });
      if (options.drift) lines.push(String(runs));
      const entries = lines.map((line, seq) => ({
        seq,
        level: 'log' as const,
        at: seq,
        args: [{ t: 'string' as const, v: line }],
      }));
      return Promise.resolve({
        v: 1,
        type: 'result',
        runId: `run-${runs}`,
        status: 'completed',
        durationMs: 1,
        console: entries,
        consoleTruncated: false,
        droppedConsoleEntries: 0,
        errors: [],
        observations: plan.checks.steps.flatMap((step) =>
          step.op === 'consoleOutput'
            ? [
                {
                  op: 'consoleOutput' as const,
                  id: step.id,
                  status: 'ok' as const,
                  entries,
                  truncated: false,
                },
              ]
            : [],
        ),
        pendingAtEnd: { timers: 0, intervals: 0 },
      });
    },
  };
}

const messages = (root: string) =>
  checkContent(root, { validateSpec: exerciseKit.validateSpec })
    .diagnostics.items.filter((d) => d.file === TEMPLATE_YAML)
    .map((d) => `${d.level} ${d.message}`);

describe('template check', () => {
  it('instantiates the sample seeds and asks for a run before approval', () => {
    const root = content();
    const result = checkContent(root, { validateSpec: exerciseKit.validateSpec });
    const [checked] = result.templates;
    expect(checked?.variants.map((v) => v.sampleIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(checked?.variants[0]?.variantId).toBe(
      `${TEMPLATE}@${sampleSeeds(TEMPLATE, 1)[0]?.toString(16)}`,
    );
    expect(messages(root)).toEqual([
      'error 변형 8개가 아직 실행 검증되지 않았습니다. pnpm content:check:run으로 검증하세요',
    ]);
    expect(messages(content({ review: { status: 'draft', draftedBy: 'ai:claude' } }))).toEqual([
      'warning 변형 8개가 아직 실행 검증되지 않았습니다. pnpm content:check:run으로 검증하세요',
    ]);
  });

  it('rejects bad metadata, engine errors, too small pools and unsupported types', () => {
    expect(messages(content({ id: 'js-basics.start.other.t.sum' }))[0]).toContain(
      `"${LESSON}.t."로 시작해야 합니다`,
    );
    expect(messages(content({ concepts: [{ id: 'js.basics.nope', weight: 1 }] }))).toContain(
      'error 없는 개념입니다: js.basics.nope',
    );
    expect(messages(content({ constraints: ['a +'] }))[0]).toContain('템플릿 형식');
    expect(messages(content({ constraints: ['a > 100'] }))[0]).toContain(
      '표본 시드 8개를 만들 수 없습니다',
    );
    expect(
      messages(
        content({
          params: { a: { kind: 'int', min: 1, max: 2 } },
          spec: { lang: 'js', code: 'console.log({{a}});', answerKind: 'console' },
          hints: ['a', 'b', 'c'],
          explanation: 'x',
        }),
      ).join('\n'),
    ).toContain('서로 다른 변형이 2개뿐입니다');
    expect(messages(content({ type: 'web_task' }))[0]).toContain('템플릿으로 만들 수 없는 유형');
    expect(
      messages(content({ spec: { lang: 'js', code: 'x', answerKind: 'nope' } })).join('\n'),
    ).toContain('invalid predict_output spec');
  });

  it('rejects a hand-written answer key in the template spec', () => {
    const root = content({
      spec: {
        lang: 'js',
        code: 'console.log({{a}});',
        answerKind: 'console',
        expected: { kind: 'console', lines: ['{{a}}'] },
      },
    });
    expect(messages(root).join('\n')).toContain('spec.expected는 직접 쓰지 않습니다');
  });
});

describe('template run check', () => {
  it('runs every pooled variant, records execution-derived keys and builds the pool', async () => {
    const root = content();
    const runner = jsRunner();
    const result = await runCheck(root, { validateSpec: exerciseKit.validateSpec, runner });
    expect(result.ok).toBe(true);
    expect(result.wrote).toEqual([join(root, TEMPLATE_EXPECTATIONS_FILE)]);
    const variants = result.items.filter((i) => i.kind === 'template');
    expect(variants).toHaveLength(8);
    expect(variants.every((v) => v.outcome.status === 'pass')).toBe(true);
    // Three runs per variant for the determinism check.
    expect(runner.runs).toBeGreaterThanOrEqual(8 * 3);

    // The recorded key is what the code printed, for each seed.
    const store = JSON.parse(readFileSync(join(root, TEMPLATE_EXPECTATIONS_FILE), 'utf8')) as {
      entries: Record<string, { expected: { lines: string[] } }>;
    };
    const tpl = checkContent(root).templates[0];
    if (!tpl) throw new Error('no template');
    for (const v of tpl.variants) {
      const { a, b, c } = instantiateVariant(engineTemplateOf(tpl.source), v.variantId).params as {
        a: number;
        b: number;
        c: number;
      };
      expect(store.entries[v.variantId]?.expected.lines).toEqual([String(a + b * c)]);
    }
    expect(messages(root)).toEqual([]);

    // Frozen and unchanged: nothing to write.
    const again = await runCheck(root, {
      validateSpec: exerciseKit.validateSpec,
      runner: jsRunner(),
      frozen: true,
    });
    expect(again).toMatchObject({ ok: true, expectationsChanged: false, wrote: [] });

    const out = join(mkdtempSync(join(tmpdir(), 'proginone-build-')), 'content.db');
    const built = buildContent(root, out, { kit: exerciseKit });
    expect(built.stats).toMatchObject({ templates: 1, templateVariants: 8 });
    const db = new Database(out, { readonly: true });
    expect(
      db
        .prepare('SELECT lesson_id, primary_concept_id, review_status FROM exercise_templates')
        .get(),
    ).toEqual({
      lesson_id: LESSON,
      primary_concept_id: 'js.basics.console-log',
      review_status: 'trusted',
    });
    const rows = db
      .prepare('SELECT variant_id, expected_json, answer_key FROM template_variants')
      .all() as { variant_id: string; expected_json: string; answer_key: string }[];
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(JSON.parse(row.expected_json)).toEqual(store.entries[row.variant_id]?.expected);
    }
    db.close();
  });

  it('fails a non-deterministic variant and keeps it out of the pool', async () => {
    const root = content({ review: { status: 'draft', draftedBy: 'ai:claude' } });
    const result = await runCheck(root, {
      validateSpec: exerciseKit.validateSpec,
      runner: jsRunner({ drift: true }),
    });
    expect(result.ok).toBe(false);
    const failed = result.items.filter((i) => i.kind === 'template' && i.outcome.status === 'fail');
    expect(failed).toHaveLength(8);
    expect(failed[0]?.outcome.messages[0]).toContain('결정론 위반');

    const out = join(mkdtempSync(join(tmpdir(), 'proginone-build-')), 'content.db');
    const built = buildContent(root, out, { kit: exerciseKit, includeDrafts: true });
    expect(built.stats).toMatchObject({ templates: 0, templateVariants: 0 });
    expect(built.diagnostics.items.map((d) => d.message)).toContain(
      '실행 검증된 변형이 없어 빌드에서 뺐습니다. pnpm content:check:run으로 검증하세요',
    );
  });

  it('errors when a misconception answer equals the executed answer for some seed', async () => {
    const root = content({
      spec: {
        lang: 'js',
        code: 'console.log({{a}} + {{b}} * {{c}});\n',
        answerKind: 'console',
        misconceptionByAnswer: { '{{a + b * c}}': 'js.mc.log-is-return' },
      },
    });
    const result = await runCheck(root, {
      validateSpec: exerciseKit.validateSpec,
      runner: jsRunner(),
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.items.map((d) => d.message).join('\n')).toContain(
      'PREDICT_MISCONCEPTION_EQUALS_ANSWER',
    );
  });

  it('skips drafts in a release build', async () => {
    const root = content({ review: { status: 'draft', draftedBy: 'ai:claude' } });
    await runCheck(root, { validateSpec: exerciseKit.validateSpec, runner: jsRunner() });
    const out = join(mkdtempSync(join(tmpdir(), 'proginone-build-')), 'content.db');
    expect(buildContent(root, out, { kit: exerciseKit }).stats).toMatchObject({
      templates: 0,
      skippedDrafts: 1,
    });
  });
});
