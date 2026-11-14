import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContent } from './check.ts';
import {
  EXPECTATIONS_FILE,
  predictInputHash,
  serializeExpectations,
  type ExpectationStore,
} from './expectations.ts';
import { exerciseKit } from './kit.ts';
import { runCheck } from './run-check.ts';
import { fakeRunner } from './test/fake-runner.ts';
import { EXERCISE_YAML, LESSON, writeContent } from './test/fixture.ts';

const PREDICT = `${LESSON}.predict-hello`;
const PREDICT_YAML =
  'courses/js-basics/modules/01-start/lessons/01-first-program/exercises/002-predict.yaml';
const CODE = 'console.log("안녕");\n';

function contentWithPredict(
  options: { status?: 'draft' | 'approved'; spec?: Record<string, unknown> } = {},
) {
  return writeContent((f) => {
    // The fixture's multiple-choice spec is a placeholder; make it valid for the real kit.
    (f[EXERCISE_YAML] as Record<string, unknown>)['spec'] = {
      options: [
        { id: 'a', text: '출력' },
        { id: 'b', text: '반환' },
        { id: 'c', text: '저장' },
      ],
      correct: 'a',
    };
    f[PREDICT_YAML] = {
      id: PREDICT,
      type: 'predict_output',
      difficulty: 1,
      concepts: [{ id: 'js.basics.console-log', weight: 1 }],
      estimatedSeconds: 40,
      prompt: '무엇이 출력되나요?',
      spec: { lang: 'js', code: CODE, answerKind: 'console', ...options.spec },
      hints: ['a', 'b', 'c'],
      explanation: '안녕이 출력됩니다.',
      review:
        options.status === 'draft'
          ? { status: 'draft', draftedBy: 'ai:claude' }
          : { status: 'approved', draftedBy: 'human', reviewedBy: 'human' },
    };
  });
}

const spec = { lang: 'js', code: CODE, answerKind: 'console' };
const store = (inputHash = predictInputHash(spec), id = PREDICT): ExpectationStore => ({
  v: 1,
  entries: { [id]: { inputHash, expected: { kind: 'console', lines: ['안녕'] } } },
});
const writeStore = (root: string, s: ExpectationStore | string) => {
  const file = join(root, EXPECTATIONS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof s === 'string' ? s : serializeExpectations(s));
};
const messagesFor = (root: string, file = PREDICT_YAML) =>
  checkContent(root, { validateSpec: exerciseKit.validateSpec })
    .diagnostics.items.filter((d) => d.file === file)
    .map((d) => `${d.level} ${d.message}`);

describe('predictInputHash', () => {
  it('depends on what determines the answer, not on key order or other fields', () => {
    const base = predictInputHash(spec);
    expect(predictInputHash({ answerKind: 'console', code: CODE, lang: 'js' })).toBe(base);
    expect(predictInputHash({ code: CODE, answerKind: 'console' })).toBe(base); // lang default
    expect(predictInputHash({ ...spec, misconceptionByAnswer: { x: 'js.mc.a' } })).toBe(base);
    expect(predictInputHash({ ...spec, expected: { kind: 'console', lines: [] } })).toBe(base);
    expect(predictInputHash({ ...spec, code: 'console.log(1);' })).not.toBe(base);
    expect(predictInputHash({ ...spec, choices: [{ id: 'a', text: '1' }] })).not.toBe(base);
  });
});

describe('expectations in check', () => {
  it('fills spec.expected from a fresh entry', () => {
    const root = contentWithPredict();
    writeStore(root, store());
    const result = checkContent(root, { validateSpec: exerciseKit.validateSpec });
    expect(result.diagnostics.items.filter((d) => d.file === PREDICT_YAML)).toEqual([]);
    const ex = result.source.courses[0]?.modules[0]?.lessons[0]?.exercises.find(
      (e) => e.data.id === PREDICT,
    );
    expect(ex?.data.spec['expected']).toEqual({ kind: 'console', lines: ['안녕'] });
  });

  it('requires a key for approved exercises and warns for drafts', () => {
    expect(messagesFor(contentWithPredict())).toEqual([
      'error 실행 기대값이 아직 없습니다. pnpm content:check:run으로 계산하세요',
    ]);
    expect(messagesFor(contentWithPredict({ status: 'draft' }))).toEqual([
      'warning 실행 기대값이 아직 없습니다. pnpm content:check:run으로 계산하세요',
    ]);
  });

  it('reports a stale key when the code changed', () => {
    const root = contentWithPredict({ status: 'draft' });
    writeStore(root, store('0'.repeat(64)));
    expect(messagesFor(root)).toEqual([
      'warning 코드가 바뀌어 실행 기대값이 낡았습니다. pnpm content:check:run으로 다시 계산하세요',
    ]);
  });

  it('rejects a hand-written expected', () => {
    const root = contentWithPredict({ spec: { expected: { kind: 'console', lines: ['안녕'] } } });
    expect(messagesFor(root)[0]).toContain('spec.expected는 직접 쓰지 않습니다');
  });

  it('runs answer-dependent spec rules once the key is known', () => {
    const root = contentWithPredict({
      spec: { misconceptionByAnswer: { 안녕: 'js.mc.log-is-return' } },
    });
    writeStore(root, store());
    expect(messagesFor(root).join('\n')).toContain('PREDICT_MISCONCEPTION_EQUALS_ANSWER');
  });

  it('flags unused entries and a malformed file', () => {
    const root = contentWithPredict({ status: 'draft' });
    writeStore(root, store(predictInputHash(spec), `${LESSON}.gone`));
    expect(messagesFor(root, EXPECTATIONS_FILE)[0]).toContain(`${LESSON}.gone`);
    writeStore(root, '{"v": 2}');
    expect(messagesFor(root, EXPECTATIONS_FILE)[0]).toContain('형식이 맞지 않습니다');
  });
});

describe('runCheck', () => {
  const runner = () => fakeRunner({ [CODE]: { lines: ['안녕'] } });

  it('verifies, writes the expectation file, and re-checks with it', async () => {
    const root = contentWithPredict();
    const result = await runCheck(root, {
      validateSpec: exerciseKit.validateSpec,
      runner: runner(),
    });
    expect(result.ok).toBe(true);
    expect(result.wrote).toBe(join(root, EXPECTATIONS_FILE));
    expect(readFileSync(join(root, EXPECTATIONS_FILE), 'utf8')).toBe(
      serializeExpectations(store()),
    );
    expect(result.items.map((i) => [i.id, i.outcome.status])).toEqual([
      [`${LESSON}.mcq-what-is-console`, 'skip'],
      [PREDICT, 'pass'],
    ]);
    expect(result.diagnostics.errorCount).toBe(0);

    const again = await runCheck(root, {
      validateSpec: exerciseKit.validateSpec,
      runner: runner(),
    });
    expect(again).toMatchObject({ expectationsChanged: false, wrote: null, ok: true });
  });

  it('fails without writing when frozen and out of date', async () => {
    const root = contentWithPredict();
    const result = await runCheck(root, {
      validateSpec: exerciseKit.validateSpec,
      runner: runner(),
      frozen: true,
    });
    expect(result).toMatchObject({ ok: false, expectationsChanged: true, wrote: null });
    expect(result.diagnostics.items.map((d) => d.message)).toContain(
      '실행 기대값 파일이 최신이 아닙니다. pnpm content:check:run을 실행하고 바뀐 파일을 커밋하세요',
    );
  });

  it('fails on a failed verification and does not run after schema errors', async () => {
    const failing = await runCheck(contentWithPredict(), {
      validateSpec: exerciseKit.validateSpec,
      runner: fakeRunner({ [CODE]: { status: 'timeout' } }),
    });
    expect(failing.ok).toBe(false);
    expect(failing.items.find((i) => i.id === PREDICT)?.outcome.messages[0]).toContain('timeout');

    const broken = await runCheck(contentWithPredict({ spec: { answerKind: 'nope' } }), {
      validateSpec: exerciseKit.validateSpec,
      runner: runner(),
    });
    expect(broken).toMatchObject({ ran: false, ok: false, items: [] });
  });
});
