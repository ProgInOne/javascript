import type { ConceptDetail } from '@proginone/shared';
import { Badge, Button, ErrorState, Skeleton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, Clock, Crosshair, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { conceptQuery } from '../../api/queries.ts';
import { useStartSet } from '../dashboard/useStartSet.ts';
import { formatShortDate } from '../goals/pace.ts';
import { MasteryIcon, STAGE_NAMES } from '../mastery/MasteryIcon.tsx';
import { evidenceText, misconceptionStatusText, scoreDelta, shortfallText } from './explain.ts';
import { RelatedExercises } from './RelatedExercises.tsx';

const ROLE_LABELS = { introduces: '처음 배우는 단원', practices: '연습', reviews: '복습' } as const;
const RATING_LABELS = { again: '다시', hard: '어려움', good: '알맞음', easy: '쉬움' } as const;

function dateLabel(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

function dueLabel(memory: NonNullable<ConceptDetail['memory']>, today: string | null): string {
  if (memory.suspended) return '복습을 잠시 멈췄어요';
  if (memory.dueToday) return '오늘 복습할 차례예요';
  if (today) {
    const days = Math.round((Date.parse(memory.dueDate) - Date.parse(today)) / 86_400_000);
    if (days === 1) return '다음 복습: 내일';
  }
  return `다음 복습: ${formatShortDate(memory.dueDate)}`;
}

/**
 * The concept detail (ui-ux.md 개념 상세, FR-DASH-02): stage and effective mastery, what the next
 * stage still needs, the evidence behind the score, the next review, prerequisites, related
 * exercises with statistics, misconceptions and related lessons. The same content in the sheet
 * and the full page.
 */
export function ConceptDetailBody({
  conceptId,
  headingLevel,
  inSheet = false,
  today = null,
  onOpenConcept,
}: {
  conceptId: string;
  /** Level of the concept title: 1 on the full page, 2 in the sheet. */
  headingLevel: 1 | 2;
  /** In the sheet the sheet's own title names the concept; the body starts with the stage. */
  inSheet?: boolean;
  /** Learner-local today (for "내일"), when known. */
  today?: string | null;
  /** Opens another concept (a prerequisite) in place; links to its page otherwise. */
  onOpenConcept?: (id: string, title: string) => void;
}) {
  const [all, setAll] = useState(false);
  const query = useQuery(conceptQuery(conceptId, all ? 200 : undefined));
  const start = useStartSet();
  if (query.isPending) return <Skeleton height={360} />;
  if (query.isError) {
    const e = query.error instanceof ApiRequestError ? query.error : null;
    return (
      <ErrorState
        variant="panel"
        headingLevel={headingLevel}
        title={e?.code === 'NOT_FOUND' ? '개념을 찾을 수 없어요' : '개념을 불러오지 못했어요'}
        description={e?.message ?? '잠시 후 다시 시도해 주세요.'}
        code={e?.code ?? 'INTERNAL'}
        action={
          e?.code === 'NOT_FOUND' ? undefined : (
            <Button onClick={() => void query.refetch()}>다시 시도</Button>
          )
        }
      />
    );
  }
  const d = query.data;
  const H = `h${String(headingLevel)}` as 'h1' | 'h2';
  const Sub = `h${String(headingLevel + 1)}` as 'h2' | 'h3';
  const due = d.memory?.dueToday === true || d.mastery.needsReview;
  const confirmed = d.misconceptions.some((m) => m.status === 'confirmed');
  const intro = d.lessons.find((l) => l.role === 'introduces') ?? d.lessons[0];
  const practiced = d.mastery.stage !== 'not_started' || d.evidenceTotal > 0;

  return (
    <article className="concept-detail" aria-labelledby={`concept-${d.concept.id}`}>
      <header className="concept-detail__head">
        {inSheet ? (
          <span id={`concept-${d.concept.id}`} className="sr-only">
            {d.concept.title}
          </span>
        ) : (
          <H id={`concept-${d.concept.id}`} className="concept-detail__title" tabIndex={-1}>
            {d.concept.title}
          </H>
        )}
        <p className="concept-detail__stage">
          <MasteryIcon stage={d.mastery.stage} due={due} weak={confirmed} size={20} decorative />
          <b>{STAGE_NAMES[d.mastery.stage]}</b>
          {practiced && <span className="tnum">· 숙련도 {Math.round(d.mastery.effective)}</span>}
          {due && (
            <Badge variant="warning" icon={<Clock size={14} />}>
              {d.memory?.dueToday ? '오늘 복습 예정' : '복습 필요'}
            </Badge>
          )}
        </p>
        <p className="text-fg-secondary">{d.concept.summary}</p>
        <p className="text-fg-tertiary type-small">{d.concept.course.title}</p>
      </header>

      <section className="concept-detail__section" aria-labelledby="concept-next">
        <Sub id="concept-next" className="concept-detail__subtitle">
          {d.nextStage ? `${STAGE_NAMES[d.nextStage.stage]}까지` : '최고 단계예요'}
        </Sub>
        {d.nextStage ? (
          d.nextStage.missing.length > 0 ? (
            <ul className="concept-detail__missing">
              {d.nextStage.missing.map((s) => (
                <li key={s.gate}>{shortfallText(s)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-fg-secondary">
              조건을 모두 채웠어요. 다음 문제를 풀면 단계가 올라가요.
            </p>
          )
        ) : (
          <p className="text-fg-secondary">숙달한 개념이에요. 가끔 복습하며 유지해요.</p>
        )}
        <p className="text-fg-secondary type-small">
          {d.memory ? dueLabel(d.memory, today) : '첫 복습일은 이 개념의 연습을 마치면 정해져요.'}
        </p>
      </section>

      {d.prerequisites.length > 0 && (
        <section className="concept-detail__section" aria-labelledby="concept-prereq">
          <Sub id="concept-prereq" className="concept-detail__subtitle">
            선수 개념
          </Sub>
          <ul className="concept-detail__chips">
            {d.prerequisites.map((p) => (
              <li key={p.concept.id}>
                {onOpenConcept ? (
                  <button
                    type="button"
                    className="concept-tile"
                    onClick={() => {
                      onOpenConcept(p.concept.id, p.concept.title);
                    }}
                  >
                    <MasteryIcon stage={p.stage} />
                    <span className="concept-tile__title">{p.concept.title}</span>
                    {p.strength === 'helpful' && (
                      <span className="sr-only">(도움이 되는 개념)</span>
                    )}
                  </button>
                ) : (
                  <Link
                    to="/concepts/$conceptId"
                    params={{ conceptId: p.concept.id }}
                    className="concept-tile no-underline"
                  >
                    <MasteryIcon stage={p.stage} />
                    <span className="concept-tile__title">{p.concept.title}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="concept-detail__section" aria-labelledby="concept-evidence">
        <Sub id="concept-evidence" className="concept-detail__subtitle">
          숙련도가 이렇게 계산됐어요
        </Sub>
        {d.evidence.length === 0 ? (
          <p className="text-fg-secondary">
            아직 근거가 없어요. 이 개념의 문제를 풀면 어떤 문제를 어떻게 풀었는지가 여기에 쌓여요.
          </p>
        ) : (
          <>
            <ol className="evidence-list">
              {d.evidence.map((e) => {
                const text = evidenceText(e);
                return (
                  <li key={e.id} data-outcome={text.outcome ?? undefined}>
                    <time className="tnum">{dateLabel(e.createdAt)}</time>
                    <span className="min-w-0">
                      <span className="evidence-list__title">{text.title}</span>
                      <span className="evidence-list__details">{text.details}</span>
                    </span>
                    <span className="evidence-list__delta tnum">
                      <span className="sr-only">숙련도 </span>
                      {scoreDelta(e)}
                    </span>
                  </li>
                );
              })}
            </ol>
            {d.evidenceTotal > d.evidence.length && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAll(true);
                }}
              >
                전체 보기 ({d.evidenceTotal}개)
              </Button>
            )}
          </>
        )}
        {d.reviews.length > 0 && (
          <p className="text-fg-secondary type-small">
            최근 복습:{' '}
            {d.reviews
              .slice(0, 5)
              .map((r) => `${dateLabel(r.reviewedAt)} ${RATING_LABELS[r.rating]}`)
              .join(' · ')}
          </p>
        )}
      </section>

      <RelatedExercises conceptId={d.concept.id} headingLevel={(headingLevel + 1) as 2 | 3} />

      {d.misconceptions.length > 0 && (
        <section className="concept-detail__section" aria-labelledby="concept-mc">
          <Sub id="concept-mc" className="concept-detail__subtitle">
            관측된 오개념
          </Sub>
          <ul className="concept-detail__list">
            {d.misconceptions.map((m) => (
              <li key={m.id}>
                <span>‘{m.title}’</span>{' '}
                <span className="text-fg-secondary type-small">({misconceptionStatusText(m)})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.lessons.length > 0 && (
        <section className="concept-detail__section" aria-labelledby="concept-lessons">
          <Sub id="concept-lessons" className="concept-detail__subtitle">
            관련 레슨
          </Sub>
          <ul className="concept-detail__list">
            {d.lessons.map((l) => (
              <li key={`${l.id}-${l.role}`}>
                <Link to="/learn/$lessonId" params={{ lessonId: l.id }}>
                  {l.title}
                </Link>{' '}
                <span className="text-fg-tertiary type-small">{ROLE_LABELS[l.role]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {start.error && (
        <ErrorState
          variant="inline"
          title="연습을 시작하지 못했어요"
          description={start.error.message}
          code={start.error.code}
        />
      )}
      <footer className="concept-detail__actions">
        {intro && (
          <Link
            to="/learn/$lessonId"
            params={{ lessonId: intro.id }}
            className="pi-button pi-button--secondary pi-button--md no-underline"
          >
            <BookOpen size={16} aria-hidden="true" />
            관련 레슨
          </Link>
        )}
        {practiced && (
          <Button
            icon={<Crosshair size={16} aria-hidden="true" />}
            loading={start.pending !== null}
            onClick={() =>
              void start.start('concept', { kind: 'weakness', conceptIds: [d.concept.id] })
            }
          >
            이 개념만 연습
          </Button>
        )}
        {d.concept.mdnUrl && (
          <a
            href={d.concept.mdnUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 type-small"
          >
            MDN 문서
            <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only">(새 탭)</span>
          </a>
        )}
      </footer>
    </article>
  );
}
