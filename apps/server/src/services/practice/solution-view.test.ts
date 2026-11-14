import { parseSpec } from '@proginone/exercise-kit';
import { solutionViewSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { EX, FIXTURE_EXERCISES } from '../../test/content-fixture.ts';
import { solutionView } from './solution-view.ts';

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
