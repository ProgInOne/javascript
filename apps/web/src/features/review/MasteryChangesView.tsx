import type { MasteryChanges } from '@proginone/shared';
import { Button, EmptyState } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowRight, ArrowUp, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { masteryChangesQuery } from '../../api/queries.ts';
import { cardClass } from '../../app/layout.ts';
import { QueryState } from '../../app/QueryState.tsx';
import { formatShortDate } from '../goals/pace.ts';
import { MasteryIcon, STAGE_NAMES } from '../mastery/MasteryIcon.tsx';

/**
 * 숙련도 변화 (FR-DASH-04, D-046): stage promotions and demotions per week for the last 8 weeks
 * and the latest changes. The chart has a table view (ui-ux.md 학습 통계: 모든 차트에 표 토글);
 * direction is shown by position (above/below the baseline), the legend and text, not by color
 * alone. Demotions are neutral gray, never red (stages fall only on evidence, not as a penalty).
 */
export function MasteryChangesView() {
  const query = useQuery(masteryChangesQuery);
  return (
    <QueryState query={query} notFoundTitle="숙련도 변화를 찾을 수 없어요">
      {(changes) => <Body changes={changes} />}
    </QueryState>
  );
}

function weekLabel(weekStart: string, current: boolean): string {
  return current ? '이번 주' : `${formatShortDate(weekStart)} 주`;
}

function Body({ changes }: { changes: MasteryChanges }) {
  const [table, setTable] = useState(false);
  if (changes.recent.length === 0 && changes.totals.promotions + changes.totals.demotions === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="아직 숙련 단계가 바뀐 개념이 없어요"
        description="문제를 풀면 개념의 숙련 단계가 오르내려요. 바뀐 기록이 여기에 주별로 모여요."
        action={
          <Link to="/courses" className="pi-button pi-button--secondary pi-button--md no-underline">
            연습하러 가기
          </Link>
        }
      />
    );
  }
  const weeks = changes.weeks;
  const last = weeks.length - 1;
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.promotions, w.demotions)));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className={`${cardClass} grid gap-4`} aria-labelledby="mastery-weeks-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="mastery-weeks-title" className="type-h3 text-heading">
              주별 숙련 단계 변화
            </h2>
            <p className="m-0 text-fg-secondary type-small">
              최근 {weeks.length}주 · 상승 {changes.totals.promotions} · 하락{' '}
              {changes.totals.demotions}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={table}
            onClick={() => {
              setTable((t) => !t);
            }}
          >
            {table ? '차트로 보기' : '표로 보기'}
          </Button>
        </div>
        {table ? (
          <table className="mastery-weeks-table">
            <caption className="sr-only">주별 숙련 단계 상승·하락 수</caption>
            <thead>
              <tr>
                <th scope="col">주</th>
                <th scope="col">상승</th>
                <th scope="col">하락</th>
                <th scope="col">바뀐 개념</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w.weekStart}>
                  <th scope="row">{weekLabel(w.weekStart, i === last)}</th>
                  <td>{w.promotions}</td>
                  <td>{w.demotions}</td>
                  <td>{w.concepts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <ul className="mastery-legend" aria-hidden="true">
              <li>
                <span className="mastery-legend__swatch" data-dir="up" />
                상승
              </li>
              <li>
                <span className="mastery-legend__swatch" data-dir="down" />
                하락
              </li>
            </ul>
            <ol className="mastery-weeks" aria-label="주별 상승·하락 막대">
              {weeks.map((w, i) => (
                <li
                  key={w.weekStart}
                  className="mastery-weeks__col"
                  data-current={i === last ? '' : undefined}
                >
                  <span className="sr-only">
                    {weekLabel(w.weekStart, i === last)}: 상승 {w.promotions}, 하락 {w.demotions}
                  </span>
                  <span className="mastery-weeks__up" aria-hidden="true">
                    {w.promotions > 0 && (
                      <span
                        className="mastery-weeks__bar"
                        data-dir="up"
                        style={{ height: `${String((w.promotions / max) * 100)}%` }}
                        title={`상승 ${String(w.promotions)}`}
                      />
                    )}
                  </span>
                  <span className="mastery-weeks__down" aria-hidden="true">
                    {w.demotions > 0 && (
                      <span
                        className="mastery-weeks__bar"
                        data-dir="down"
                        style={{ height: `${String((w.demotions / max) * 100)}%` }}
                        title={`하락 ${String(w.demotions)}`}
                      />
                    )}
                  </span>
                  <span className="mastery-weeks__label" aria-hidden="true">
                    {i === last ? '이번 주' : formatShortDate(w.weekStart)}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section
        className={`${cardClass} grid content-start gap-3`}
        aria-labelledby="mastery-recent-title"
      >
        <h2 id="mastery-recent-title" className="type-h3 text-heading">
          최근 바뀐 개념
        </h2>
        {changes.recent.length === 0 ? (
          <p className="m-0 text-fg-secondary">최근 {weeks.length}주에는 바뀐 단계가 없어요.</p>
        ) : (
          <ul className="mastery-recent">
            {changes.recent.map((c) => (
              <li key={c.id}>
                <span className="mastery-recent__dir" data-dir={c.direction}>
                  {c.direction === 'up' ? (
                    <ArrowUp size={16} aria-label="상승" />
                  ) : (
                    <ArrowDown size={16} aria-label="하락" />
                  )}
                </span>
                <span className="min-w-0">
                  <Link to="/concepts/$conceptId" params={{ conceptId: c.concept.id }}>
                    {c.concept.title}
                  </Link>
                  <span className="mastery-recent__stages">
                    <MasteryIcon stage={c.stageBefore} decorative />
                    {STAGE_NAMES[c.stageBefore]}
                    <ArrowRight size={12} aria-label="에서" />
                    <MasteryIcon stage={c.stageAfter} decorative />
                    {STAGE_NAMES[c.stageAfter]}
                  </span>
                </span>
                <span className="mastery-recent__date">{formatShortDate(c.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
