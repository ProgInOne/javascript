import type { MasteryChange, PassResultView, PracticeSetView } from '@proginone/shared';
import { Check, CircleDashed } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { STAGE_LABELS } from './model.ts';

const percent = (n: number) => `${Math.round(n * 100)}%`;

/** Pass rule checks in learner language (learning-engine.md#단원-연습-세트). */
function passLines(pass: PassResultView): { met: boolean; text: string }[] {
  const c = pass.checks;
  const lines = [
    {
      met: c.minCorrect.met,
      text: `정답 비율 ${percent(c.minCorrect.actual)} (기준 ${percent(c.minCorrect.required)})`,
    },
    {
      met: c.minDistinctTypes.met,
      text: `맞힌 문제 유형 ${c.minDistinctTypes.actual}가지 (기준 ${c.minDistinctTypes.required}가지)`,
    },
  ];
  if (c.minLevel3Correct.required > 0) {
    lines.push({
      met: c.minLevel3Correct.met,
      text: `L3 이상 문제 정답 ${c.minLevel3Correct.actual}개 (기준 ${c.minLevel3Correct.required}개)`,
    });
  }
  lines.push({
    met: c.minConceptScore.met,
    text: c.minConceptScore.met
      ? '이 단원의 개념을 모두 기준만큼 연습했어요'
      : `연습이 더 필요한 개념: ${c.minConceptScore.below.map((b) => b.title).join(', ')}`,
  });
  return lines;
}

/**
 * The end of a practice set (ui-ux.md 단원 완료 순간 / 복습 종료 요약): counts, concept stage
 * changes seen in this session, the pass result and the next step. No confetti or sound.
 */
export function SetSummary({
  set,
  title,
  changes,
  actions,
}: {
  set: PracticeSetView;
  /** e.g. "첫 프로그램" (lesson) or null for a review set. */
  title: string | null;
  /** Concept changes of this session (first before → last after). */
  changes: readonly MasteryChange[];
  actions: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const result = set.result;
  const pass = result?.pass ?? null;
  const needsPractice = new Set(pass?.checks.minConceptScore.below.map((b) => b.id) ?? []);
  const heading =
    set.kind === 'review'
      ? '오늘의 복습을 마쳤어요'
      : pass?.passed
        ? `${title ?? '이'} 단원을 마쳤어요`
        : '연습을 마쳤어요';

  return (
    <section className="set-summary" aria-labelledby="set-summary-title">
      <h2 id="set-summary-title" ref={headingRef} tabIndex={-1} className="set-summary__title">
        {(pass?.passed ?? set.kind === 'review') && (
          <Check size={24} aria-hidden="true" className="set-summary__check" />
        )}
        {heading}
      </h2>
      {result && (
        <p className="set-summary__stats">
          연습 {result.total}문제 · 정답 {result.correct}
          {result.skipped > 0 && ` · 건너뜀 ${result.skipped}`}
        </p>
      )}
      {pass && !pass.passed && (
        <p className="set-summary__note">
          아직 단원 통과 기준에 조금 못 미쳤어요. 한 번 더 연습하면 다시 확인할 수 있어요.
        </p>
      )}

      {changes.length > 0 && (
        <div className="set-summary__block">
          <h3 className="set-summary__subtitle">개념 변화</h3>
          <ul className="set-summary__list">
            {changes.map((c) => (
              <li key={c.conceptId}>
                <span className="set-summary__stage">
                  {c.stageBefore === c.stageAfter
                    ? `${STAGE_LABELS[c.stageAfter]} (그대로)`
                    : `${STAGE_LABELS[c.stageBefore]} → ${STAGE_LABELS[c.stageAfter]}`}
                </span>
                <span>{c.title}</span>
                {needsPractice.has(c.conceptId) && (
                  <span className="text-fg-tertiary type-small">아직 연습이 더 필요해요</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pass && (
        <div className="set-summary__block">
          <h3 className="set-summary__subtitle">통과 기준</h3>
          <ul className="set-summary__list">
            {passLines(pass).map((line) => (
              <li key={line.text} data-met={line.met}>
                {line.met ? (
                  <Check size={16} aria-label="충족" />
                ) : (
                  <CircleDashed size={16} aria-label="미충족" />
                )}
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="set-summary__actions">{actions}</div>
    </section>
  );
}
