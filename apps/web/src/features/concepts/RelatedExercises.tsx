import type { ExerciseStats } from '@proginone/shared';
import { Button, ErrorState, Skeleton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { relatedExercisesQuery } from '../../api/queries.ts';
import { TYPE_LABELS } from '../practice/model.ts';
import { dateLabel, excerpt } from '../review/format.ts';

/** Rows shown before "모두 보기". */
const SHOWN = 6;

const percent = (rate: number) => `${String(Math.round(rate * 100))}%`;

/** "시도 3회 · 첫 시도 정답률 50% · 힌트 사용 33% · 마지막 11/13", or "아직 풀지 않았어요". */
export function statsText(s: ExerciseStats): string {
  if (s.attempts === 0) return '아직 풀지 않았어요';
  const parts = [`시도 ${String(s.attempts)}회`];
  if (s.firstTryCorrectRate !== null) {
    parts.push(`첫 시도 정답률 ${percent(s.firstTryCorrectRate)}`);
  }
  if (s.hintUsageRate !== null && s.hintUsageRate > 0) {
    parts.push(`힌트 사용 ${percent(s.hintUsageRate)}`);
  }
  if (s.lastAttemptAt !== null) parts.push(`마지막 ${dateLabel(s.lastAttemptAt)}`);
  return parts.join(' · ');
}

/**
 * 관련 문제 (ui-ux.md 개념 상세, FR-DASH-02, FR-EX-10, D-061): the concept's practice exercises,
 * easiest first, with the learner's statistics. Loaded separately from the concept detail so the
 * sheet does not wait for it. The server leaves out assessment items and an assessment in
 * progress, so nothing here can reveal withheld results.
 */
export function RelatedExercises({
  conceptId,
  headingLevel,
}: {
  conceptId: string;
  headingLevel: 2 | 3;
}) {
  const [all, setAll] = useState(false);
  const query = useQuery(relatedExercisesQuery(conceptId));
  const Sub = `h${String(headingLevel)}` as 'h2' | 'h3';
  const titleId = `concept-exercises-${conceptId}`;
  let body;
  if (query.isPending) {
    body = <Skeleton height={96} />;
  } else if (query.isError) {
    body = (
      <ErrorState
        variant="inline"
        title="관련 문제를 불러오지 못했어요"
        description={query.error.message}
        action={<Button onClick={() => void query.refetch()}>다시 시도</Button>}
      />
    );
  } else if (query.data.exercises.length === 0) {
    body = <p className="text-fg-secondary">이 개념을 주로 다루는 연습 문제가 아직 없어요.</p>;
  } else {
    const { exercises } = query.data;
    const solved = exercises.filter((e) => e.stats.attempts > 0).length;
    const shown = all ? exercises : exercises.slice(0, SHOWN);
    body = (
      <>
        <p className="text-fg-secondary type-small">
          {exercises.length}문제 중 {solved}문제를 풀어 봤어요.
        </p>
        <ul className="related-exercises">
          {shown.map((e) => (
            <li key={e.id} data-solved={e.stats.attempts > 0 || undefined}>
              <span className="related-exercises__title">
                {TYPE_LABELS[e.type] ?? e.type} · L{e.difficulty}
                {e.lesson && <span className="related-exercises__lesson"> · {e.lesson.title}</span>}
              </span>
              <span className="related-exercises__prompt">{excerpt(e.prompt)}</span>
              <span className="related-exercises__stats tnum">{statsText(e.stats)}</span>
            </li>
          ))}
        </ul>
        {!all && exercises.length > SHOWN && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAll(true);
            }}
          >
            모두 보기 ({exercises.length}개)
          </Button>
        )}
      </>
    );
  }
  return (
    <section className="concept-detail__section" aria-labelledby={titleId}>
      <Sub id={titleId} className="concept-detail__subtitle">
        관련 문제
      </Sub>
      {body}
    </section>
  );
}
