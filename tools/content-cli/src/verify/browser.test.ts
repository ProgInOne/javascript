import type { ExerciseSource } from '@proginone/content-schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserMissingError, startBrowserRunner, type BrowserRunner } from './browser.ts';
import { examplePlan, verifyExample, verifyExercise } from './cases.ts';

/**
 * Integration: the real runner (shell, harness, per-shell sites) in headless Chromium. Skipped
 * where Chromium is not installed (the CI unit-test job); `pnpm content:check:run` in the E2E
 * job covers the same path against the real content.
 */

let runner: BrowserRunner | null = null;
beforeAll(async () => {
  try {
    runner = await startBrowserRunner({ concurrency: 2 });
  } catch (error) {
    if (!(error instanceof BrowserMissingError)) throw error;
  }
}, 60_000);
afterAll(async () => {
  await runner?.close();
});

const exercise = (type: string, spec: Record<string, unknown>): ExerciseSource => ({
  id: 'js-basics.start.first-program.x',
  type,
  difficulty: 1,
  concepts: [{ id: 'js.basics.console-log', weight: 1 }],
  tags: [],
  estimatedSeconds: 60,
  usage: 'practice',
  workedExampleStage: null,
  variantGroup: null,
  prompt: '문제',
  spec,
  hints: ['a', 'b', 'c'],
  explanation: '해설',
  misconceptions: [],
  origin: 'authored',
  review: { status: 'draft', draftedBy: 'human' },
});

describe('browser runner', () => {
  it('runs JS and DOM plans in the sandbox', async (ctx) => {
    if (!runner) return ctx.skip();
    const js = await runner.run(examplePlan('js', 'let a = 1;\nconsole.log("합", a + 1);'));
    expect(js.status).toBe('completed');
    expect(js.console[0]?.args).toEqual([
      { t: 'string', v: '합' },
      { t: 'number', v: 2 },
    ]);
    const dom = await runner.run(examplePlan('html', '<p>안녕</p><script>missing()</script>'));
    expect(dom.errors[0]).toMatchObject({ phase: 'runtime', name: 'ReferenceError' });
  });

  it('verifies predict, fix_bug and web_task exercises end to end', async (ctx) => {
    if (!runner) return ctx.skip();
    const predict = await verifyExercise(
      exercise('predict_output', {
        code: 'let n = 1;\nn = n + 1;\nconsole.log(n);',
        answerKind: 'console',
      }),
      runner,
    );
    expect(predict).toMatchObject({ status: 'pass', expected: { kind: 'console', lines: ['2'] } });

    const fix = await verifyExercise(
      exercise('fix_bug', {
        buggy: { files: [{ path: 'main.js', content: 'console.log("1 + 1");' }] },
        solution: { files: [{ path: 'main.js', content: 'console.log(1 + 1);' }] },
        bugDescription: '계산되지 않아요.',
        checks: [{ kind: 'console', id: 'out', expect: { lines: ['2'] } }],
      }),
      runner,
    );
    expect(fix.status).toBe('pass');

    const page = (width: string) =>
      `<!doctype html><style>.box { width: ${width}; height: 10px; }</style><div class="box"></div>`;
    const web = await verifyExercise(
      exercise('web_task', {
        focus: 'css',
        starter: { files: [{ path: 'index.html', content: page('100px') }] },
        solution: { files: [{ path: 'index.html', content: page('200px') }] },
        checks: [
          {
            kind: 'css',
            id: 'w',
            selector: '.box',
            expect: { computed: { width: { equals: '200px' } } },
          },
        ],
      }),
      runner,
    );
    expect(web.status).toBe('pass');
  });

  it('detects a nondeterministic predict program and a mislabeled example', async (ctx) => {
    if (!runner) return ctx.skip();
    const random = await verifyExercise(
      exercise('predict_output', { code: 'console.log(Math.random());', answerKind: 'console' }),
      runner,
    );
    expect(random.status).toBe('fail');
    expect(random.messages[0]).toContain('결정론 위반');

    const example = await verifyExample(
      { id: 'e', lang: 'js', code: 'console.log(1);', expectError: true },
      runner,
    );
    expect(example.status).toBe('fail');
  });
});
