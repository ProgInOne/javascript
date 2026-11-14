import { expect, test } from '@playwright/test';
import { buildRunPlan, gradeSubmission } from '../../packages/exercise-kit/src/index.ts';
import { openRunner, run } from './sandbox-fixtures.ts';

/**
 * Contract between the runner and the grader: plans come from exercise-kit's `buildRunPlan`,
 * run in the real sandbox, and the `RunResult` goes through exercise-kit's `gradeSubmission`
 * (which parses it with the shared `parseRunResult`). If the runner's observations drift from the
 * shared contract, these grades change.
 */

const implementFunction = {
  starter: { files: [{ path: 'main.js', content: 'function sum(list) {\n}\n' }] },
  entry: 'sum',
  solution: {
    files: [
      {
        path: 'main.js',
        content: 'function sum(list) { return list.reduce((s, n) => s + n, 0); }',
      },
    ],
  },
  checks: [
    { kind: 'call', id: 'basic', args: [[1, 2]], expect: { equals: 3 } },
    { kind: 'call', id: 'empty', args: [[]], expect: { equals: 0 } },
    { kind: 'call', id: 'pure', args: [[4, 5]], expect: { argsUnchanged: true } },
    {
      kind: 'call',
      id: 'map',
      argsExpr: '[[...new Map([["a", 2]]).values()]]',
      expect: { equals: 2 },
    },
    { kind: 'console', id: 'out', expect: { lines: ['ready'] } },
    { kind: 'program', id: 'prog', expect: { globals: { total: { equals: 6 } } } },
  ],
};

const webTask = {
  focus: 'dom',
  starter: { files: [{ path: 'index.html', content: '<!doctype html>\n<ul></ul>' }] },
  solution: { files: [{ path: 'index.html', content: '<!doctype html>\n<ul></ul>' }] },
  checks: [
    { kind: 'dom', id: 'list', selector: 'ul.cards', expect: { exists: true } },
    {
      kind: 'css',
      id: 'flex',
      selector: '.cards',
      expect: { computed: { display: { equals: 'flex' } } },
    },
    { kind: 'layout', id: 'row', a: '#first', b: '#second', relation: 'left-of' },
    {
      kind: 'event',
      id: 'add',
      steps: [
        { action: 'type', selector: '#name', value: '하나' },
        { action: 'click', selector: '#add' },
      ],
      expect: [{ selector: 'ul.cards li', count: 3 }],
    },
  ],
};

const WEB_ANSWER = `<!doctype html>
<style>.cards { display: flex; gap: 8px; } li { width: 50px; }</style>
<ul class="cards"><li id="first">a</li><li id="second">b</li></ul>
<input id="name"><button id="add">추가</button>
<script>
document.getElementById('add').addEventListener('click', () => {
  const li = document.createElement('li');
  li.textContent = document.getElementById('name').value;
  document.querySelector('.cards').append(li);
});
</script>`;

test.describe('runner ↔ exercise-kit grading contract', () => {
  test('implement_function: a correct answer is graded correct, a wrong one is not', async ({
    page,
  }) => {
    await openRunner(page);
    const grade = async (content: string) => {
      const answer = { files: [{ path: 'main.js', content }] };
      const plan = buildRunPlan({
        typeId: 'implement_function',
        spec: implementFunction,
        answer,
        purpose: 'grading',
      });
      const result = await run(page, plan);
      return gradeSubmission({
        typeId: 'implement_function',
        spec: implementFunction,
        answer,
        run: result,
      });
    };

    const correct = await grade(
      'function sum(list) { return list.reduce((s, n) => s + n, 0); }\nconst total = sum([1, 2, 3]);\nconsole.log("ready");',
    );
    expect(correct).toMatchObject({ outcome: 'correct', correct: true, score: 1 });

    const wrong = await grade(
      'function sum(list) { list.push(0); return list.length; }\nconst total = 6;\nconsole.log("ready");',
    );
    expect(wrong.correct).toBe(false);
    expect(wrong.outcome).toBe('partial');

    const looping = await grade('function sum(list) { while (true) {} }\nsum([]);');
    expect(looping.outcome).toBe('error');
  });

  test('web_task: DOM, CSS, layout and cumulative event checks', async ({ page }) => {
    await openRunner(page);
    const grade = async (content: string) => {
      const answer = { files: [{ path: 'index.html', content }] };
      const plan = buildRunPlan({ typeId: 'web_task', spec: webTask, answer, purpose: 'grading' });
      const result = await run(page, plan);
      return gradeSubmission({ typeId: 'web_task', spec: webTask, answer, run: result });
    };

    expect(await grade(WEB_ANSWER)).toMatchObject({ outcome: 'correct', score: 1 });
    const noFlex = await grade(WEB_ANSWER.replace('display: flex; ', ''));
    expect(noFlex.correct).toBe(false);
    expect(noFlex.score).toBeGreaterThan(0);
  });
});
