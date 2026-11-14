import type { ExerciseSource } from '@proginone/content-schema';
import { describe, expect, it } from 'vitest';
import { compileLessonMdx } from '../mdx.ts';
import { fakeRunner, runtimeError, syntaxError } from '../test/fake-runner.ts';
import { lessonMdx } from '../test/fixture.ts';
import { collectExamples, PREDICT_RUNS, verifyExample, verifyExercise } from './cases.ts';

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

const predict = (code: string, extra: Record<string, unknown> = {}) =>
  exercise('predict_output', { lang: 'js', code, answerKind: 'console', ...extra });

const consoleCheck = (lines: string[]) => ({
  kind: 'console',
  id: 'output',
  description: '출력이 맞아야 합니다.',
  expect: { lines },
});

const fixBug = (buggy: string, solution: string, lines: string[]) =>
  exercise('fix_bug', {
    buggy: { files: [{ path: 'main.js', content: buggy }] },
    solution: { files: [{ path: 'main.js', content: solution }] },
    bugDescription: '증상',
    checks: [consoleCheck(lines)],
  });

describe('verifyExercise: predict_output', () => {
  it('computes the answer key from three identical runs', async () => {
    const runner = fakeRunner({ 'console.log(1)': { lines: ['1'] } });
    const outcome = await verifyExercise(predict('console.log(1)'), runner);
    expect(outcome).toMatchObject({
      status: 'pass',
      expected: { kind: 'console', lines: ['1'] },
    });
    expect(runner.plans).toHaveLength(PREDICT_RUNS);
    expect(runner.plans[0]?.purpose).toBe('verification');
  });

  it('ignores a stored key and recomputes', async () => {
    const runner = fakeRunner({ 'console.log(2)': { lines: ['2'] } });
    const ex = predict('console.log(2)', { expected: { kind: 'console', lines: ['9'] } });
    expect((await verifyExercise(ex, runner)).expected).toEqual({ kind: 'console', lines: ['2'] });
  });

  it('fails when runs disagree (determinism)', async () => {
    let n = 0;
    const runner = fakeRunner({ 'console.log(Math.random())': { lines: () => [String(n++)] } });
    const outcome = await verifyExercise(predict('console.log(Math.random())'), runner);
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain('결정론 위반');
    expect(outcome.messages).toContain('2번째 실행: 콘솔 1줄: 1');
  });

  it('explains an unexpected runtime error', async () => {
    const runner = fakeRunner({
      'x()': { errors: [runtimeError('ReferenceError', 'x is not defined')] },
    });
    const outcome = await verifyExercise(predict('x()'), runner);
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain(
      '실행 중 오류: ReferenceError: x is not defined (main.js 1행)',
    );
    expect(outcome.messages[0]).toContain('answerKind: error');
  });

  it('records the error name for answerKind error', async () => {
    const runner = fakeRunner({ 'x()': { errors: [runtimeError('ReferenceError', 'x')] } });
    const outcome = await verifyExercise(predict('x()', { answerKind: 'error' }), runner);
    expect(outcome.expected).toEqual({ kind: 'error', thrown: true, name: 'ReferenceError' });
  });

  it('rejects syntax errors, which have no output to predict', async () => {
    const runner = fakeRunner({ 'x(': { errors: [syntaxError('Unexpected end of input')] } });
    const outcome = await verifyExercise(predict('x(', { answerKind: 'error' }), runner);
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain('문법 오류가 있는 코드는');
  });

  it('needs exactly one matching choice', async () => {
    const runner = fakeRunner({ 'console.log(1)': { lines: ['1'] } });
    const ex = predict('console.log(1)', {
      answerKind: 'choice',
      choices: [
        { id: 'a', text: '1' },
        { id: 'b', text: '1' },
      ],
    });
    const outcome = await verifyExercise(ex, runner);
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain('정확히 하나의 선택지');
  });
});

describe('verifyExercise: code types', () => {
  const programs = {
    'console.log("a")': { lines: ['a'] },
    'console.log("b")': { lines: ['b'] },
  };

  it('passes when the solution passes and the buggy code fails', async () => {
    const runner = fakeRunner(programs);
    const outcome = await verifyExercise(
      fixBug('console.log("b")', 'console.log("a")', ['a']),
      runner,
    );
    expect(outcome.status).toBe('pass');
    expect(outcome.messages[0]).toBe('참조 정답은 필수 체크 1개 통과, 버그 코드는 1개 실패');
    expect(runner.plans.map((p) => p.purpose)).toEqual(['verification', 'verification']);
  });

  it('fails when the solution misses a required check', async () => {
    const outcome = await verifyExercise(
      fixBug('console.log("b")', 'console.log("b")', ['a']),
      fakeRunner(programs),
    );
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toBe('참조 정답이 필수 체크 1개를 통과하지 못합니다');
    expect(outcome.messages[1]).toContain('"output" (출력이 맞아야 합니다.)');
  });

  it('fails when the buggy code already passes', async () => {
    const outcome = await verifyExercise(
      fixBug('console.log("a")', 'console.log("a")', ['a']),
      fakeRunner(programs),
    );
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain('버그 코드가 이미 모든 필수 체크를 통과합니다');
  });

  it('fills code-mode blanks with the first accepted answer, and empties them for the baseline', async () => {
    const runner = fakeRunner(programs);
    const ex = exercise('fill_blank', {
      mode: 'code',
      template: 'console.log({{blank:v}})',
      blanks: [{ id: 'v', accept: ['"a"', "'a'"] }],
      checks: [consoleCheck(['a'])],
    });
    expect((await verifyExercise(ex, runner)).status).toBe('pass');
    expect(runner.plans.map((p) => p.files[0]?.content)).toEqual([
      'console.log("a")',
      'console.log()',
    ]);
  });

  it('needs an accepted example for every code-mode blank', async () => {
    const ex = exercise('fill_blank', {
      mode: 'code',
      template: 'console.log({{blank:v}})',
      blanks: [{ id: 'v', acceptRegex: '"a"' }],
      checks: [consoleCheck(['a'])],
    });
    const outcome = await verifyExercise(ex, fakeRunner({}));
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain('accept 예시');
  });

  it('skips types without code to run', async () => {
    const mcq = exercise('mcq_single', {
      options: [
        { id: 'a', text: '가' },
        { id: 'b', text: '나' },
        { id: 'c', text: '다' },
      ],
      correct: 'a',
    });
    expect((await verifyExercise(mcq, fakeRunner({}))).status).toBe('skip');
  });

  it('reports an invalid spec instead of throwing', async () => {
    const outcome = await verifyExercise(exercise('fix_bug', {}), fakeRunner({}));
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain('실행 검증을 할 수 없습니다');
  });
});

describe('lesson examples', () => {
  it('collects RunnableExample nodes with their code', () => {
    const { tree } = compileLessonMdx(
      lessonMdx({
        examples:
          '<RunnableExample id="a" lang="js">\n```js\nconsole.log(1);\n```\n</RunnableExample>\n\n' +
          '<RunnableExample id="b" lang="css" expectError>\n```css\np {}\n```\n</RunnableExample>',
      }),
    );
    expect(collectExamples(tree)).toEqual([
      { id: 'a', lang: 'js', code: 'console.log(1);', expectError: false },
      { id: 'b', lang: 'css', code: 'p {}', expectError: true },
    ]);
  });

  const example = (code: string, expectError = false, lang = 'js') => ({
    id: 'e',
    lang,
    code,
    expectError,
  });
  const runner = fakeRunner({
    ok: { lines: ['ok'] },
    bad: { errors: [runtimeError('TypeError', 'nope', 2)] },
  });

  it('passes a clean run and fails an unexpected error', async () => {
    expect((await verifyExample(example('ok'), runner)).status).toBe('pass');
    const outcome = await verifyExample(example('bad'), runner);
    expect(outcome.status).toBe('fail');
    expect(outcome.messages).toEqual([
      '오류 없이 실행되어야 합니다. 의도한 오류라면 expectError를 표시하세요',
      '실행 중 오류: TypeError: nope (main.js 2행)',
    ]);
  });

  it('requires an error when marked expectError', async () => {
    expect((await verifyExample(example('bad', true), runner)).status).toBe('pass');
    const outcome = await verifyExample(example('ok', true), runner);
    expect(outcome.status).toBe('fail');
    expect(outcome.messages[0]).toContain('expectError로 표시했지만');
  });

  it('runs HTML in a DOM run and skips CSS-only snippets', async () => {
    const r = fakeRunner({});
    await verifyExample(example('<p>hi</p>', false, 'web'), r);
    expect(r.plans[0]).toMatchObject({ mode: 'dom', entry: 'index.html' });
    expect((await verifyExample(example('p {}', false, 'css'), r)).status).toBe('skip');
  });
});
