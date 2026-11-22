import {
  redactSpec,
  type FillBlankAnswer,
  type FillBlankPublicSpec,
  type McqSingleAnswer,
  type McqSinglePublicSpec,
  type PredictOutputAnswer,
  type PredictOutputPublicSpec,
} from '@proginone/exercise-kit';
import type { RunResult } from '@proginone/run-contract';
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { initialAnswer, isAnswerReady, notReadyReason, parsePublicSpec } from '../exercise.ts';
import { axeViolations, renderUi } from '../test/helpers.tsx';
import { FillBlank, parseBlankTemplate } from './FillBlank.tsx';
import { McqSingle } from './McqSingle.tsx';
import { PredictOutput } from './PredictOutput.tsx';

const mcqSpec: McqSinglePublicSpec = {
  options: [
    { id: 'a', text: '`8`' },
    { id: 'b', text: '`undefined`' },
    { id: 'c', text: '`null`' },
    { id: 'd', text: '오류가 발생한다' },
  ],
  codeOptions: false,
};

function Mcq({ correctOptionId }: { correctOptionId?: string }) {
  const [value, setValue] = useState<McqSingleAnswer | null>(null);
  return (
    <>
      <h2 id="prompt">result에 들어 있는 값은?</h2>
      <McqSingle
        spec={mcqSpec}
        value={value}
        onChange={setValue}
        labelledBy="prompt"
        {...(correctOptionId === undefined ? {} : { correctOptionId })}
      />
      <output data-testid="value">{value?.optionId ?? ''}</output>
    </>
  );
}

describe('McqSingle', () => {
  it('is a labelled radio group with arrow-key and number-key selection', async () => {
    const { user, container } = renderUi(<Mcq />);
    const group = screen.getByRole('radiogroup', { name: 'result에 들어 있는 값은?' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      '18',
      '2undefined',
      '3null',
      '4오류가 발생한다',
    ]);

    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByTestId('value').textContent).toBe('a');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('value').textContent).toBe('b');
    await user.keyboard('4');
    expect(screen.getByTestId('value').textContent).toBe('d');
    expect(document.activeElement).toBe(radios[3]);
    await user.keyboard('9');
    expect(screen.getByTestId('value').textContent).toBe('d');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('marks the correct option and the learner choice after grading', () => {
    renderUi(
      <McqSingle
        spec={mcqSpec}
        value={{ optionId: 'c' }}
        onChange={() => undefined}
        correctOptionId="b"
        disabled
      />,
    );
    expect(
      screen.getByRole('radio', { name: /undefined/ }).closest('label')?.textContent,
    ).toContain('정답');
    expect(screen.getByRole('radio', { name: /null/ }).closest('label')?.textContent).toContain(
      '내가 고른 답',
    );
    expect(screen.getByRole('radio', { name: /8/ }).closest('label')?.dataset['state']).toBe(
      undefined,
    );
  });

  it('renders code options as code', () => {
    renderUi(
      <McqSingle
        spec={{ ...mcqSpec, codeOptions: true }}
        value={null}
        onChange={() => undefined}
        disabled
      />,
    );
    expect(
      screen.getByRole('radiogroup', { name: '선택지' }).querySelectorAll('code'),
    ).toHaveLength(4);
    expect(screen.getAllByRole('radio').every((r) => (r as HTMLInputElement).disabled)).toBe(true);
  });
});

const textBlankSpec: FillBlankPublicSpec = {
  mode: 'text',
  template: 'function add(a, b) {\n  {{blank:b1}} a {{blank:b2}} b;\n}',
  blanks: [{ id: 'b1', width: 8 }, { id: 'b2' }],
};

function Blanks({
  spec = textBlankSpec,
  feedback,
}: {
  spec?: FillBlankPublicSpec;
  feedback?: Parameters<typeof FillBlank>[0]['feedback'];
}) {
  const [value, setValue] = useState<FillBlankAnswer>({ blanks: {} });
  return (
    <>
      <FillBlank
        spec={spec}
        value={value}
        onChange={setValue}
        {...(feedback === undefined ? {} : { feedback })}
      />
      <output data-testid="value">{JSON.stringify(value.blanks)}</output>
    </>
  );
}

describe('FillBlank', () => {
  it('splits the template into text and blanks', () => {
    expect(parseBlankTemplate('a {{blank:x}} b')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'blank', id: 'x' },
      { kind: 'text', text: ' b' },
    ]);
  });

  it('renders inline inputs in reading order; Tab moves to the next blank', async () => {
    const { user, container } = renderUi(<Blanks />);
    expect(container.querySelector('pre')?.textContent).toContain('function add(a, b) {');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '빈칸 1 / 2' }));
    await user.keyboard('return');
    await user.tab();
    await user.keyboard('+');
    expect(screen.getByTestId('value').textContent).toBe('{"b1":"return","b2":"+"}');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('marks blanks from grader feedback with icon and text', () => {
    renderUi(
      <Blanks
        feedback={[
          { level: 'success', code: 'BLANK_CORRECT', message: '맞았습니다.', target: 'b1' },
          {
            level: 'error',
            code: 'BLANK_WRONG',
            message: '이 빈칸의 답이 맞지 않습니다.',
            target: 'b2',
          },
        ]}
      />,
    );
    const wrong = screen.getByRole('textbox', {
      name: '빈칸 2 / 2',
      description: '이 빈칸의 답이 맞지 않습니다.',
    });
    expect(wrong.getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.getByRole('textbox', { name: '빈칸 1 / 2' }).getAttribute('aria-invalid'),
    ).toBeNull();
  });

  it('renders a one-line sentence as text and lists checks in code mode', () => {
    const { unmount } = renderUi(
      <Blanks
        spec={{ mode: 'text', template: '문단은 {{blank:p}} 태그로 써요.', blanks: [{ id: 'p' }] }}
      />,
    );
    expect(document.querySelector('pre')).toBeNull();
    unmount();

    renderUi(
      <Blanks
        spec={{
          mode: 'code',
          template: 'const x = {{blank:v}};',
          blanks: [{ id: 'v' }],
          lang: 'js',
          checks: [
            {
              id: 'out',
              kind: 'console',
              visible: true,
              required: true,
              weight: 1,
              expect: { lines: ['3'] },
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole('region', { name: '테스트' })).toBeTruthy();
  });
});

function Predict({ spec, actual }: { spec: PredictOutputPublicSpec; actual?: RunResult }) {
  const [value, setValue] = useState<PredictOutputAnswer | null>(null);
  return (
    <>
      <PredictOutput
        spec={spec}
        value={value}
        onChange={setValue}
        {...(actual === undefined ? {} : { actual, onRunActual: () => undefined })}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const code = 'const a = [1, 2, 3];\nconst b = a;\nb.push(4);\nconsole.log(a.length);';

describe('PredictOutput', () => {
  it('shows read-only numbered code and a multi-line output field', async () => {
    const { user, container } = renderUi(
      <Predict spec={{ lang: 'js', code, answerKind: 'console' }} />,
    );
    expect(screen.getByRole('figure', { name: 'JavaScript' }).textContent).toContain(
      '4console.log(a.length);',
    );
    await user.type(screen.getByRole('textbox', { name: '예상 출력' }), '4{Enter}done');
    expect(screen.getByTestId('value').textContent).toBe('{"console":"4\\ndone"}');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('asks for a value of the named identifier', async () => {
    const { user } = renderUi(
      <Predict
        spec={{
          lang: 'js',
          code: 'let result = 1 + "2";',
          answerKind: 'value',
          expression: 'result',
        }}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: '실행이 끝난 뒤 result의 값' }), '"12"');
    expect(screen.getByTestId('value').textContent).toBe('{"value":"\\"12\\""}');
  });

  it('asks whether an error is thrown, then optionally which one', async () => {
    const { user, container } = renderUi(
      <Predict spec={{ lang: 'js', code: 'null.x;', answerKind: 'error' }} />,
    );
    await user.click(screen.getByRole('radio', { name: '오류 없이 끝나요' }));
    expect(screen.getByTestId('value').textContent).toBe('{"error":{"thrown":false}}');
    expect(screen.queryByRole('radiogroup', { name: '어떤 오류인가요? (선택)' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: '오류가 발생해요' }));
    await user.click(screen.getByRole('radio', { name: 'TypeError' }));
    expect(screen.getByTestId('value').textContent).toBe(
      '{"error":{"thrown":true,"name":"TypeError"}}',
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('offers choices as code options', async () => {
    const { user } = renderUi(
      <Predict
        spec={{
          lang: 'js',
          code,
          answerKind: 'choice',
          choices: [
            { id: 'x', text: '3' },
            { id: 'y', text: '4' },
          ],
        }}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /4/ }));
    expect(screen.getByTestId('value').textContent).toBe('{"choiceId":"y"}');
  });

  it('compares the prediction with the actual run line by line', async () => {
    const actual: RunResult = {
      v: 1,
      type: 'result',
      runId: 'r',
      status: 'completed',
      durationMs: 3,
      console: [
        { seq: 0, level: 'log', args: [{ t: 'number', v: 4 }], at: 0 },
        { seq: 1, level: 'log', args: [{ t: 'string', v: 'done' }], at: 0 },
      ],
      consoleTruncated: false,
      droppedConsoleEntries: 0,
      errors: [],
      observations: [],
      pendingAtEnd: { timers: 0, intervals: 0 },
    };
    const { user } = renderUi(
      <Predict spec={{ lang: 'js', code, answerKind: 'console' }} actual={actual} />,
    );
    await user.type(screen.getByRole('textbox', { name: '예상 출력' }), '3{Enter}done');
    const table = screen.getByRole('table', { name: /2줄 중 1줄 일치/ });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(['134다름', '2donedone일치']);
    expect(screen.getByRole('button', { name: '실제로 실행' })).toBeTruthy();
  });
});

describe('exercise model helpers', () => {
  it('validates redacted specs and rejects unknown types or bad input', () => {
    const raw = redactSpec('mcq_single', {
      options: [
        { id: 'a', text: '1' },
        { id: 'b', text: '2' },
        { id: 'c', text: '3' },
      ],
      correct: 'b',
      shuffle: false,
    });
    const exercise = parsePublicSpec('mcq_single', raw);
    expect(exercise?.typeId).toBe('mcq_single');
    expect(JSON.stringify(exercise)).not.toContain('correct');
    expect(parsePublicSpec('mcq_single', { options: 'x' })).toBeNull();
    expect(parsePublicSpec('parsons', raw)).toBeNull();
  });

  it('builds initial answers and readiness', () => {
    const mcq = { typeId: 'mcq_single', spec: mcqSpec } as const;
    expect(initialAnswer(mcq)).toBeNull();
    expect(isAnswerReady(mcq, null)).toBe(false);
    expect(isAnswerReady(mcq, { optionId: 'a' })).toBe(true);
    expect(notReadyReason(mcq)).toBe('답을 먼저 골라 주세요.');

    const blanks = { typeId: 'fill_blank', spec: textBlankSpec } as const;
    expect(isAnswerReady(blanks, { blanks: { b1: 'return' } })).toBe(false);
    expect(isAnswerReady(blanks, { blanks: { b1: 'return', b2: '+' } })).toBe(true);

    const code = {
      typeId: 'fix_bug' as const,
      spec: {
        buggy: { files: [{ path: 'main.js', content: 'x' }] },
        checks: [],
        bugDescription: '평균이 0이에요',
      },
    };
    const answer = initialAnswer(code);
    expect(answer).toEqual({ files: [{ path: 'main.js', content: 'x' }] });
    expect(answer.files[0]).not.toBe(code.spec.buggy.files[0]);
  });
});
