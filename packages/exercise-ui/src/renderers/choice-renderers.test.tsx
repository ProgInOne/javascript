import {
  redactSpec,
  type McqMultiAnswer,
  type McqMultiPublicSpec,
  type TrueFalsePublicSpec,
} from '@proginone/exercise-kit';
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { initialAnswer, isAnswerReady, notReadyReason, parsePublicSpec } from '../exercise.ts';
import { axeViolations, renderUi } from '../test/helpers.tsx';
import { ExerciseRenderer } from './ExerciseRenderer.tsx';
import { McqMulti } from './McqMulti.tsx';
import { TrueFalse, type TrueFalseDraft } from './TrueFalse.tsx';

const multiSpec: McqMultiPublicSpec = {
  options: [
    { id: 'a', text: '`let`' },
    { id: 'b', text: '`var`' },
    { id: 'c', text: '`const`' },
  ],
  minSelect: 1,
  codeOptions: false,
};

function Multi({ spec = multiSpec }: { spec?: McqMultiPublicSpec }) {
  const [value, setValue] = useState<McqMultiAnswer>({ optionIds: [] });
  return (
    <>
      <h2 id="prompt">변수를 선언하는 키워드를 모두 고르세요.</h2>
      <McqMulti spec={spec} value={value} onChange={setValue} labelledBy="prompt" />
      <output data-testid="value">{value.optionIds.join(',')}</output>
    </>
  );
}

describe('McqMulti', () => {
  it('is a labelled checkbox group with Space and number-key toggling', async () => {
    const { user, container } = renderUi(<Multi />);
    const group = screen.getByRole('group', { name: '변수를 선언하는 키워드를 모두 고르세요.' });
    const note = document.getElementById(group.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('해당하는 것을 모두 고르세요. 정답이 여러 개일 수 있어요.');
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);

    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByTestId('value').textContent).toBe('a');
    await user.keyboard('3');
    expect(screen.getByTestId('value').textContent).toBe('a,c');
    expect(document.activeElement).toBe(boxes[2]);
    // Answer order follows the option order, not the click order.
    await user.click(within(group).getByRole('checkbox', { name: /var/ }));
    expect(screen.getByTestId('value').textContent).toBe('a,b,c');
    await user.keyboard('1');
    expect(screen.getByTestId('value').textContent).toBe('b,c');
    await user.keyboard('9');
    expect(screen.getByTestId('value').textContent).toBe('b,c');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('states minSelect without revealing the number of correct options', () => {
    renderUi(<Multi spec={{ ...multiSpec, minSelect: 2 }} />);
    expect(screen.getByText(/2개 이상/)).toBeTruthy();
  });

  it('does not change when disabled', async () => {
    const { user } = renderUi(
      <McqMulti
        spec={multiSpec}
        value={{ optionIds: ['a'] }}
        onChange={() => undefined}
        disabled
      />,
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.every((b) => (b as HTMLInputElement).disabled)).toBe(true);
    await user.keyboard('2');
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
  });
});

const tfSpec: TrueFalsePublicSpec = {
  statement: '`const`로 선언한 배열에는 `push`를 할 수 없다.',
};
const tfReasonSpec: TrueFalsePublicSpec = {
  ...tfSpec,
  reasons: [
    { id: 'r1', text: 'const는 재할당만 막는다' },
    { id: 'r2', text: 'const는 값 내부 변경도 막는다' },
  ],
};

function Tf({ spec = tfSpec }: { spec?: TrueFalsePublicSpec }) {
  const [value, setValue] = useState<TrueFalseDraft>({});
  return (
    <>
      <h2 id="prompt">다음 설명이 맞는지 고르세요.</h2>
      <TrueFalse spec={spec} value={value} onChange={setValue} labelledBy="prompt" />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('TrueFalse', () => {
  it('shows the statement and a 참/거짓 radio group with number keys', async () => {
    const { user, container } = renderUi(<Tf />);
    const group = screen.getByRole('radiogroup', { name: /다음 설명이 맞는지 고르세요\..*push/ });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent),
    ).toEqual(['1참', '2거짓']);
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByTestId('value').textContent).toBe('{"value":true}');
    await user.keyboard('2');
    expect(screen.getByTestId('value').textContent).toBe('{"value":false}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /거짓/ }));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks for a reason when the exercise requires one', async () => {
    const { user, container } = renderUi(<Tf spec={tfReasonSpec} />);
    const reasons = screen.getByRole('radiogroup', { name: '왜 그런가요? 이유를 고르세요.' });
    await user.click(within(reasons).getByRole('radio', { name: /재할당만/ }));
    expect(screen.getByTestId('value').textContent).toBe('{"reasonId":"r1"}');
    await user.click(screen.getByRole('radio', { name: /거짓/ }));
    expect(screen.getByTestId('value').textContent).toBe('{"reasonId":"r1","value":false}');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('exercise model (mcq_multi, true_false)', () => {
  it('parses public specs from redaction and builds answers and readiness', () => {
    const multiRaw = redactSpec('mcq_multi', {
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
        { id: 'c', text: 'C' },
      ],
      correct: ['a', 'b'],
      minSelect: 2,
    });
    const multi = parsePublicSpec('mcq_multi', multiRaw);
    if (multi?.typeId !== 'mcq_multi') throw new Error('not parsed');
    expect(JSON.stringify(multi)).not.toContain('correct');
    expect(initialAnswer(multi)).toEqual({ optionIds: [] });
    expect(isAnswerReady(multi, { optionIds: ['a'] })).toBe(false);
    expect(isAnswerReady(multi, { optionIds: ['a', 'c'] })).toBe(true);
    expect(notReadyReason(multi)).toBe('답을 2개 이상 골라 주세요.');

    const tf = parsePublicSpec(
      'true_false',
      redactSpec('true_false', { statement: 'S', answer: true }),
    );
    if (tf?.typeId !== 'true_false') throw new Error('not parsed');
    expect(tf.spec).toEqual({ statement: 'S' });
    expect(initialAnswer(tf)).toEqual({});
    expect(isAnswerReady(tf, {})).toBe(false);
    expect(isAnswerReady(tf, { value: false })).toBe(true);
    const tfr = { typeId: 'true_false', spec: tfReasonSpec } as const;
    expect(isAnswerReady(tfr, { value: false })).toBe(false);
    expect(isAnswerReady(tfr, { value: false, reasonId: 'r2' })).toBe(true);
    expect(notReadyReason(tfr)).toBe('참/거짓과 이유를 골라 주세요.');
  });

  it('renders both through ExerciseRenderer', () => {
    renderUi(
      <>
        <ExerciseRenderer
          exercise={{ typeId: 'mcq_multi', spec: multiSpec }}
          value={{ optionIds: [] }}
          onChange={() => undefined}
        />
        <ExerciseRenderer
          exercise={{ typeId: 'true_false', spec: tfSpec }}
          value={{}}
          onChange={() => undefined}
        />
      </>,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});
