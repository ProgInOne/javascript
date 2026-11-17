import type { PassResultView } from '@proginone/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { practiceSet } from '../../test/practice-fixtures.ts';
import { SetSummary } from './SetSummary.tsx';

type Checks = PassResultView['checks'];

const ELEMENTS = { id: 'html.doc.elements', title: '요소' };
const NESTING = { id: 'html.doc.nesting', title: '중첩' };

function pass(concepts: Pick<Checks, 'minConceptCredit' | 'minConceptScore'>): PassResultView {
  const met = (concepts.minConceptCredit ?? concepts.minConceptScore)?.met ?? true;
  return {
    passed: met,
    checks: {
      allAnswered: true,
      minCorrect: { met: true, required: 0.7, actual: 0.95 },
      minDistinctTypes: { met: true, required: 2, actual: 5 },
      minLevel3Correct: { met: true, required: 0, actual: 0 },
      ...concepts,
    },
  };
}

function renderSummary(result: PassResultView) {
  const set = practiceSet({
    status: 'completed',
    result: { total: 13, answered: 13, skipped: 0, correct: 11, pass: result },
  });
  render(<SetSummary set={set} title="HTML 문서의 뼈대" changes={[]} actions={null} />);
}

describe('SetSummary concept lines (D-081)', () => {
  it('shows each concept under the bar with its result in this set and the next step', () => {
    renderSummary(
      pass({
        minConceptCredit: {
          met: false,
          required: 0.6,
          actual: 1 / 3,
          below: [ELEMENTS],
          concepts: [
            { ...ELEMENTS, credit: 1 / 3, correct: 1, total: 3, met: false },
            { ...NESTING, credit: 1, correct: 2, total: 2, met: true },
          ],
        },
      }),
    );
    const line = screen.getByText('‘요소’ 이번 연습 1/3 정답').closest('li');
    expect(line).toHaveAttribute('data-met', 'false');
    // The status icon, the result and the next step are all in the item's accessible text.
    expect(line?.querySelector('[aria-label="미충족"]')).not.toBeNull();
    expect(line).toHaveTextContent(/한 번 더 연습하거나 .*약점 집중/);
    expect(line).toHaveTextContent(/다음 단원으로 넘어가도 괜찮아요/);
    expect(screen.queryByText(/‘중첩’/)).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('연습을 마쳤어요');
  });

  it('says every concept did well enough when the bar is met', () => {
    renderSummary(
      pass({
        minConceptCredit: {
          met: true,
          required: 0.6,
          actual: 2 / 3,
          below: [],
          concepts: [{ ...ELEMENTS, credit: 2 / 3, correct: 2, total: 3, met: true }],
        },
      }),
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('단원을 마쳤어요');
    expect(
      screen.getByText('이 단원의 개념마다 이번 연습에서 충분히 맞혔어요'),
    ).toBeInTheDocument();
  });

  it('keeps the plain list for results stored before D-081', () => {
    renderSummary(
      pass({ minConceptScore: { met: false, required: 50, actual: 31.2, below: [ELEMENTS] } }),
    );
    expect(screen.getByText('연습이 더 필요한 개념: 요소')).toBeInTheDocument();
  });
});
