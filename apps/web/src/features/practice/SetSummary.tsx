import type { MasteryChange, PassResultView, PracticeSetView } from '@proginone/shared';
import { Check, CircleDashed } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { STAGE_LABELS } from './model.ts';

const percent = (n: number) => `${Math.round(n * 100)}%`;

interface PassLine {
  met: boolean;
  text: string;
  detail?: string;
}

type Checks = PassResultView['checks'];

const CONCEPT_HINT =
  '한 번 더 연습하거나 대시보드의 약점 집중으로 이 개념을 연습해 보세요. 다음 단원으로 넘어가도 괜찮아요.';

/**
 * Concept lines (D-081): one per concept under the bar, with its result in this set and the next
 * step. Results from before D-081 judged the long-term mastery score and list the concepts only.
 */
function conceptLines(credit: Checks['minConceptCredit'], legacy: Checks['minConceptScore']) {
  const lines: PassLine[] = [];
  if (credit) {
    if (credit.met) {
      lines.push({ met: true, text: '이 단원의 개념마다 이번 연습에서 충분히 맞혔어요' });
    }
    for (const c of credit.concepts.filter((x) => !x.met)) {
      lines.push({
        met: false,
        text: `‘${c.title}’ 이번 연습 ${c.correct}/${c.total} 정답`,
        detail: CONCEPT_HINT,
      });
    }
  } else if (legacy) {
    lines.push(
      legacy.met
        ? { met: true, text: '이 단원의 개념을 모두 기준만큼 연습했어요' }
        : {
            met: false,
            text: `연습이 더 필요한 개념: ${legacy.below.map((b) => b.title).join(', ')}`,
          },
    );
  }
  return lines;
}

/** Pass rule checks in learner language (learning-engine.md#단원-연습-세트). */
function passLines(pass: PassResultView): PassLine[] {
  const c = pass.checks;
  const lines: PassLine[] = [
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
  lines.push(...conceptLines(c.minConceptCredit, c.minConceptScore));
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
  review,
  actions,
}: {
  set: PracticeSetView;
  /** e.g. "첫 프로그램" (lesson) or null for a review set. */
  title: string | null;
  /** Concept changes of this session (first before → last after). */
  changes: readonly MasteryChange[];
  /** "푼 문제 돌아보기" (D-098), between the result and the next step. */
  review?: ReactNode;
  actions: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const result = set.result;
  const pass = result?.pass ?? null;
  const below = pass?.checks.minConceptCredit?.below ?? pass?.checks.minConceptScore?.below ?? [];
  const needsPractice = new Set(below.map((b) => b.id));
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
          아직 단원 통과 기준에 조금 못 미쳤어요. 한 번 더 연습하면 다시 확인할 수 있고, 다음
          단원으로 넘어가도 괜찮아요.
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
                <span className="set-summary__line">
                  <span>{line.text}</span>
                  {line.detail && (
                    <span className="block text-fg-tertiary type-small">{line.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review}

      <div className="set-summary__actions">{actions}</div>
    </section>
  );
}
