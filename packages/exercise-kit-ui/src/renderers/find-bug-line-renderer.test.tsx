import { redactSpec, type FindBugLinePublicSpec } from '@proginone/exercise-kit';
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { initialAnswer, isAnswerReady, notReadyReason, parsePublicSpec } from '../exercise.ts';
import { axeViolations, renderUi } from '../test/helpers.tsx';
import { ExerciseRenderer } from './ExerciseRenderer.tsx';
import { FindBugLine, type FindBugLineDraft } from './FindBugLine.tsx';

const spec: FindBugLinePublicSpec = {
  code: 'const prices = [100, 200];\nlet total;\n\nfor (const p of prices) total += p;\nconsole.log(total);',
  symptom: '출력이 `NaN`입니다.',
  causeOptions: [
    { id: 'c1', text: 'total이 undefined에서 시작한다' },
    { id: 'c2', text: 'for...of는 배열에 쓸 수 없다' },
  ],
};

function Harness({ s = spec }: { s?: FindBugLinePublicSpec }) {
  const [value, setValue] = useState<FindBugLineDraft>({});
  return (
    <>
      <h2 id="prompt">합계가 NaN으로 나오는 원인을 찾으세요.</h2>
      <FindBugLine spec={s} value={value} onChange={setValue} labelledBy="prompt" />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const value = () => screen.getByTestId('value').textContent;

describe('FindBugLine', () => {
  it('shows the symptom and selects a line with the keyboard', async () => {
    const { user, container } = renderUi(<Harness />);
    expect(screen.getByText('증상')).toBeTruthy();
    const lines = screen.getByRole('radiogroup', { name: '증상의 원인이 되는 줄을 고르세요.' });
    const radios = within(lines).getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      '1번 줄: const prices = [100, 200];',
      '2번 줄: let total;',
      '3번 줄: 빈 줄',
      '4번 줄: for (const p of prices) total += p;',
      '5번 줄: console.log(total);',
    ]);
    await user.tab();
    await user.keyboard(' ');
    expect(value()).toBe('{"line":1}');
    await user.keyboard('{ArrowDown}');
    expect(value()).toBe('{"line":2}');
    expect(radios[1]?.closest('label')?.dataset['checked']).toBe('true');

    const causes = screen.getByRole('radiogroup', { name: '그 줄이 문제인 이유를 고르세요.' });
    await user.click(within(causes).getByRole('radio', { name: /undefined에서/ }));
    expect(value()).toBe('{"line":2,"causeId":"c1"}');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('marks the graded line from feedback and locks when disabled', async () => {
    const { container } = renderUi(
      <FindBugLine
        spec={spec}
        value={{ line: 4, causeId: 'c1' }}
        onChange={() => undefined}
        disabled
        feedback={[
          {
            level: 'error',
            code: 'FIND_BUG_WRONG_LINE',
            message: '이 줄은 증상의 원인이 아닙니다.',
            target: '4',
          },
        ]}
      />,
    );
    const line4 = screen.getByRole('radio', { name: /^4번 줄/ }).closest('label');
    expect(line4?.dataset['state']).toBe('error');
    expect(line4?.textContent).toContain('이 줄은 증상의 원인이 아닙니다.');
    expect(screen.getAllByRole('radio').every((r) => (r as HTMLInputElement).disabled)).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('exercise model (find_bug_line)', () => {
  it('parses the redacted spec and builds answers and readiness', () => {
    const raw = redactSpec('find_bug_line', {
      code: 'let a;\na += 1;',
      bugLines: [1],
      symptom: 'NaN',
      symptomCheck: { console: ['NaN'] },
      fixedCode: 'let a = 0;\na += 1;',
    });
    const exercise = parsePublicSpec('find_bug_line', raw);
    if (exercise?.typeId !== 'find_bug_line') throw new Error('not parsed');
    expect(JSON.stringify(exercise)).not.toMatch(/bugLines|fixedCode|symptomCheck/);
    expect(initialAnswer(exercise)).toEqual({});
    expect(isAnswerReady(exercise, {})).toBe(false);
    expect(isAnswerReady(exercise, { line: 1 })).toBe(true);
    expect(notReadyReason(exercise)).toBe('원인이 되는 줄을 골라 주세요.');
    const withCauses = { typeId: 'find_bug_line', spec } as const;
    expect(isAnswerReady(withCauses, { line: 2 })).toBe(false);
    expect(isAnswerReady(withCauses, { line: 2, causeId: 'c2' })).toBe(true);
    expect(notReadyReason(withCauses)).toBe('줄과 이유를 골라 주세요.');
  });

  it('renders through ExerciseRenderer', () => {
    renderUi(
      <ExerciseRenderer
        exercise={{ typeId: 'find_bug_line', spec: { code: 'a;\nb;', symptom: '증상' } }}
        value={{}}
        onChange={() => undefined}
      />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText('그 줄이 문제인 이유를 고르세요.')).toBeNull();
  });
});
