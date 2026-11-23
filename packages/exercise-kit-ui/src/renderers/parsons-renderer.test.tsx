import {
  parsonsPublicId,
  redactSpec,
  type FeedbackItem,
  type ParsonsAnswer,
  type ParsonsPublicSpec,
} from '@proginone/exercise-kit';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { initialAnswer, isAnswerReady, notReadyReason, parsePublicSpec } from '../exercise.ts';
import { axeViolations, renderUi } from '../test/helpers.tsx';
import { ExerciseRenderer } from './ExerciseRenderer.tsx';
import { Parsons } from './Parsons.tsx';

const spec: ParsonsPublicSpec = {
  blocks: [
    { id: 'b3', code: 'console.log(total);' },
    { id: 'b1', code: 'let total = 0;' },
    { id: 'bx', code: 'total = 5;' },
    { id: 'b2', code: 'total += 2;' },
  ],
  gradeIndent: true,
};

function Harness({
  initial = { order: [] },
  feedback,
  disabled,
}: {
  initial?: ParsonsAnswer;
  feedback?: FeedbackItem[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState<ParsonsAnswer>(initial);
  return (
    <>
      <h2 id="prompt">합계를 출력하도록 줄을 배열하세요.</h2>
      <Parsons
        spec={spec}
        value={value}
        onChange={setValue}
        labelledBy="prompt"
        {...(feedback === undefined ? {} : { feedback })}
        {...(disabled === undefined ? {} : { disabled })}
      />
      <output data-testid="value">
        {value.order.map((i) => `${i.id}:${String(i.indent)}`).join(' ')}
      </output>
    </>
  );
}

const value = () => screen.getByTestId('value').textContent;

describe('Parsons', () => {
  it('builds the answer with the keyboard only', async () => {
    const { user, container } = renderUi(<Harness />);
    expect(screen.getByText(/필요 없는 조각이 섞여 있을 수 있어요/)).toBeTruthy();
    const bank = screen.getByRole('region', { name: '코드 조각' });
    expect(within(bank).getAllByRole('button')).toHaveLength(4);
    expect(await axeViolations(container)).toEqual([]);

    // Tab to the first block, add three blocks with Enter / Space.
    await user.tab();
    expect(document.activeElement?.textContent).toBe('console.log(total);');
    await user.keyboard('{Enter}');
    expect(value()).toBe('b3:0');
    // The added block left the list; focus moved to the block now in its place.
    expect(document.activeElement?.textContent).toBe('let total = 0;');
    await user.keyboard(' ');
    expect(value()).toBe('b3:0 b1:0');
    const answer = screen.getByRole('listbox', { name: '내 답안' });
    expect(within(answer).getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText(/답안 2번째 줄에 놓았어요/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('moves, indents and removes the selected line with keys and toolbar buttons', async () => {
    const order = (ids: string[]) => ({ order: ids.map((id) => ({ id, indent: 0 })) });
    const { user } = renderUi(<Harness initial={order(['b3', 'b1', 'b2'])} />);
    const answer = screen.getByRole('listbox', { name: '내 답안' });
    answer.focus();
    // The first line is selected by default.
    expect(within(answer).getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(value()).toBe('b1:0 b3:0 b2:0');
    expect(screen.getByText('2번째 줄로 옮겼어요.')).toBeTruthy();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(value()).toBe('b1:0 b2:0 b3:0');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(value()).toBe('b1:0 b2:1 b3:0');
    await user.keyboard(']');
    expect(value()).toBe('b1:0 b2:2 b3:0');
    await user.keyboard('[['); // `[` escaped for user-event
    expect(value()).toBe('b1:0 b2:1 b3:0');
    expect(screen.getByText('들여쓰기 1단계')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '위로 옮기기' }));
    expect(value()).toBe('b2:1 b1:0 b3:0');
    await user.click(screen.getByRole('button', { name: '내어쓰기' }));
    expect(value()).toBe('b2:0 b1:0 b3:0');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '위로 옮기기' }).disabled).toBe(
      true,
    );

    answer.focus();
    await user.keyboard('{Delete}');
    expect(value()).toBe('b1:0 b3:0');
    const bank = screen.getByRole('region', { name: '코드 조각' });
    expect(within(bank).getByRole('button', { name: /total \+= 2;/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '조각으로 돌려놓기' }));
    expect(value()).toBe('b3:0');
  });

  it('accepts drag and drop as an enhancement', () => {
    renderUi(<Harness initial={{ order: [{ id: 'b1', indent: 0 }] }} />);
    const data = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      setData: (type: string, v: string) => {
        data.set(type, v);
        dataTransfer.types = [...data.keys()];
      },
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: 'all',
    };
    const block = screen.getByRole('button', { name: /total \+= 2;/ });
    fireEvent.dragStart(block, { dataTransfer });
    const first = screen.getByRole('option');
    fireEvent.dragOver(first, { dataTransfer });
    fireEvent.drop(first, { dataTransfer });
    expect(value()).toBe('b2:0 b1:0');
    // Dragging a line back to the blocks removes it.
    const [, moved] = screen.getAllByRole('option');
    if (!moved) throw new Error('no second line');
    fireEvent.dragStart(moved, { dataTransfer });
    fireEvent.drop(screen.getByRole('region', { name: '코드 조각' }), { dataTransfer });
    expect(value()).toBe('b2:0');
  });

  it('marks lines from feedback and locks everything when disabled', async () => {
    const { container } = renderUi(
      <Harness
        initial={{
          order: [
            { id: 'b1', indent: 0 },
            { id: 'b2', indent: 1 },
          ],
        }}
        disabled
        feedback={[
          {
            level: 'success',
            code: 'PARSONS_IN_PLACE',
            message: '제자리에 있어요.',
            target: 'block:b1',
          },
          {
            level: 'error',
            code: 'PARSONS_INDENT_WRONG',
            message: '순서는 맞지만 들여쓰기가 달라요.',
            target: 'block:b2',
          },
        ]}
      />,
    );
    const [first, second] = screen.getAllByRole('option');
    expect(first?.dataset['state']).toBe('success');
    expect(first?.textContent).toContain('제자리에 있어요.');
    expect(second?.dataset['state']).toBe('error');
    expect(second?.textContent).toContain('들여쓰기 1단계');
    const bank = screen.getByRole('region', { name: '코드 조각' });
    expect(
      within(bank)
        .getAllByRole('button')
        .every((b) => (b as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('exercise model (parsons)', () => {
  it('parses the redacted spec and builds answers and readiness', () => {
    const raw = redactSpec(
      'parsons',
      {
        lines: [
          { id: 'l1', code: 'let a = 1;' },
          { id: 'l2', code: 'console.log(a);' },
        ],
        distractors: [{ id: 'd1', code: 'a = 2;' }],
      },
      { shuffleSeed: 'x' },
    );
    const exercise = parsePublicSpec('parsons', raw);
    if (exercise?.typeId !== 'parsons') throw new Error('not parsed');
    expect(exercise.spec.blocks.map((b) => b.id).sort()).toEqual(
      ['l1', 'l2', 'd1'].map(parsonsPublicId).sort(),
    );
    expect(initialAnswer(exercise)).toEqual({ order: [] });
    expect(isAnswerReady(exercise, { order: [] })).toBe(false);
    expect(isAnswerReady(exercise, { order: [{ id: 'x', indent: 0 }] })).toBe(true);
    expect(notReadyReason(exercise)).toBe('코드 조각을 답안에 놓아 주세요.');
  });

  it('renders through ExerciseRenderer with the check list for run-graded specs', () => {
    renderUi(
      <ExerciseRenderer
        exercise={{
          typeId: 'parsons',
          spec: {
            ...spec,
            gradeIndent: false,
            checks: [
              {
                kind: 'console',
                id: 'out',
                visible: true,
                required: true,
                weight: 1,
                expect: { lines: ['2'] },
              },
            ],
          },
        }}
        value={{ order: [] }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('listbox', { name: '내 답안' })).toBeTruthy();
    expect(screen.queryByText(/들여쓰기도 맞춰/)).toBeNull();
    expect(screen.getByText(/테스트|체크/)).toBeTruthy();
  });
});
