import { parseSpec } from '@proginone/exercise-kit';
import { solutionViewSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { CORRECT, WRONG } from '../../test/answers.ts';
import { ANSWER_MARKERS, EX, FIXTURE_EXERCISES } from '../../test/content-fixture.ts';
import { answerView, solutionView } from './solution-view.ts';

const viewOf = (id: string) => {
  const ex = FIXTURE_EXERCISES.find((e) => e.id === id);
  if (!ex) throw new Error(`no fixture ${id}`);
  return solutionView(ex.type, parseSpec(ex.type, ex.spec));
};

describe('solutionView', () => {
  it.each(FIXTURE_EXERCISES.map((e) => [e.type, e.id]))(
    '%s: conforms to the shared schema and is not empty',
    (_type, id) => {
      const view = viewOf(id);
      expect(solutionViewSchema.safeParse(view).success).toBe(true);
      expect(view.kind).not.toBe('none');
    },
  );

  it('lists every correct option of mcq_multi', () => {
    expect(viewOf(EX.mcqMulti)).toEqual({
      kind: 'choices',
      choices: [
        { id: 'a', text: '`console.log`는 값을 출력한다' },
        { id: 'b', text: '문장은 위에서 아래로 실행된다' },
      ],
    });
  });

  it('names the bug line and its cause for find_bug_line', () => {
    expect(viewOf(EX.findBug)).toEqual({
      kind: 'text',
      text: '1번 줄이에요. 이유: total에 처음 값이 없다',
    });
  });

  it('assembles the parsons reference program', () => {
    expect(viewOf(EX.parsons)).toEqual({
      kind: 'files',
      files: [{ path: 'main.js', content: 'const name = "코코";\nconsole.log(name);\n' }],
    });
  });

  it('states the true_false verdict, with the reason when one is asked for', () => {
    expect(viewOf(EX.trueFalse)).toEqual({ kind: 'text', text: '거짓이에요.' });
    const spec = parseSpec('true_false', {
      statement: 's',
      answer: true,
      requireReason: true,
      reasons: [
        { id: 'r1', text: '이유 하나', correct: true },
        { id: 'r2', text: '이유 둘' },
      ],
    });
    expect(solutionView('true_false', spec)).toEqual({
      kind: 'text',
      text: '참이에요. 이유: 이유 하나',
    });
  });
});

describe('answerView', () => {
  const answerOf = (id: string, answer: unknown) => {
    const ex = FIXTURE_EXERCISES.find((e) => e.id === id);
    if (!ex) throw new Error(`no fixture ${id}`);
    return answerView(ex.type, parseSpec(ex.type, ex.spec), answer);
  };

  it.each(FIXTURE_EXERCISES.filter((e) => WRONG[e.id] !== undefined).map((e) => [e.type, e.id]))(
    '%s: shows the wrong answer without answer-key text',
    (_type, id) => {
      const view = answerOf(id, WRONG[id]);
      expect(solutionViewSchema.safeParse(view).success).toBe(true);
      expect(view.kind).not.toBe('none');
      for (const marker of ANSWER_MARKERS) expect(JSON.stringify(view)).not.toContain(marker);
    },
  );

  it('words the learner answer per type', () => {
    expect(answerOf(EX.trueFalse, WRONG[EX.trueFalse])).toEqual({
      kind: 'text',
      text: '참이라고 답했어요.',
    });
    expect(answerOf(EX.findBug, WRONG[EX.findBug])).toMatchObject({
      kind: 'text',
      text: expect.stringMatching(/^3번 줄이라고 답했어요\. 이유: /) as string,
    });
    expect(answerOf(EX.predict, WRONG[EX.predict])).toEqual({ kind: 'console', lines: ['11'] });
    expect(answerOf(EX.fillText, WRONG[EX.fillText])).toEqual({
      kind: 'blanks',
      blanks: [{ id: 'b1', answer: ':' }],
    });
    expect(answerOf(EX.parsons, WRONG[EX.parsons])).toEqual({
      kind: 'files',
      files: [{ path: 'main.js', content: 'console.log(name);\nconst name = "코코";\n' }],
    });
    expect(answerOf(EX.parsons, CORRECT[EX.parsons])).toEqual(viewOf(EX.parsons));
  });

  it('falls back to none for an answer of another shape', () => {
    expect(answerOf(EX.trueFalse, { value: 'yes' })).toEqual({ kind: 'none' });
    expect(answerOf(EX.findBug, {})).toEqual({ kind: 'none' });
    expect(answerView('unknown_type', {}, {})).toEqual({ kind: 'none' });
  });
});
