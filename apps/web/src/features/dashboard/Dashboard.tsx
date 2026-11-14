import type {
  DailyPlanBlockView,
  DailyPlanView,
  GoalStatus,
  MasteryOverview,
  ReviewQueue,
  WeakConcepts,
} from '@proginone/shared';
import { Badge, Button, Checkbox, ErrorState, ProgressRing, Select, Skeleton } from '@proginone/ui';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  BookOpen,
  Check,
  Clock,
  Crosshair,
  Layers,
  Repeat,
  Target,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import {
  dailyPlanQuery,
  goalsQuery,
  masteryQuery,
  reviewQueueQuery,
  weakConceptsQuery,
} from '../../api/queries.ts';
import { cardClass } from '../../app/layout.ts';
import { formatMinutes } from '../../lib/format.ts';
import { GoalRing, todayMinutes, WeekStrip } from '../goals/GoalRing.tsx';
import { formatLocalDate, formatShortDate, paceText } from '../goals/pace.ts';
import { MasteryIcon, STAGE_NAMES } from '../mastery/MasteryIcon.tsx';
import { ConceptSheet } from '../concepts/ConceptSheet.tsx';
import { blockReason, blockTitle } from './plan.ts';
import { useStartSet } from './useStartSet.ts';

const buttonLink = 'pi-button no-underline';

/**
 * The dashboard (ui-ux.md 대시보드, FR-DASH-01): "지금 무엇을 하면 되는가" first — today's plan,
 * today's reviews, the concept map, course progress and weak concepts. Each card loads on its
 * own, so one failing request does not hide the rest.
 */
export function Dashboard() {
  const plan = useQuery(dailyPlanQuery);
  const goals = useQuery(goalsQuery);
  const mastery = useQuery(masteryQuery);
  const queue = useQuery(reviewQueueQuery);
  const weak = useQuery(weakConceptsQuery);
  const start = useStartSet();
  // Concept detail sheet (ui-ux.md: from the dashboard the detail opens as a sheet).
  const [sheet, setSheet] = useState<{ id: string; title: string } | null>(null);
  // The tile that opened the sheet gets focus back when it closes (ui-ux.md 포커스 관리).
  const opener = useRef<HTMLElement | null>(null);
  const openFromMap = (concept: { id: string; title: string }) => {
    if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
    setSheet(concept);
  };

  if (plan.isError && mastery.isError) {
    const e = plan.error instanceof ApiRequestError ? plan.error : null;
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title={
          e?.code === 'NETWORK'
            ? 'ProgInOne 서버에 연결할 수 없어요'
            : '대시보드를 불러오지 못했어요'
        }
        description={
          e?.code === 'NETWORK'
            ? '터미널에서 실행 중인지 확인해 주세요.'
            : (e?.message ?? '잠시 후 다시 시도해 주세요.')
        }
        code={e?.code ?? 'INTERNAL'}
        action={
          <Button
            onClick={() => {
              void plan.refetch();
              void mastery.refetch();
            }}
          >
            다시 시도
          </Button>
        }
      />
    );
  }

  const fresh =
    mastery.data !== undefined &&
    mastery.data.courses.every((c) => c.stageCounts.not_started === totalOf(c.stageCounts)) &&
    (plan.data?.activeMinutesToday ?? 0) === 0;

  return (
    <div className="dashboard">
      <Greeting plan={plan.data} goals={goals.data} fresh={fresh} />
      {start.error && (
        <ErrorState
          variant="inline"
          title="연습 세트를 시작하지 못했어요"
          description={start.error.message}
          code={start.error.code}
        />
      )}
      <div className="dashboard__grid">
        <Card
          id="today-plan"
          icon={Target}
          title="오늘의 학습"
          className="dashboard__plan"
          badge={
            plan.data && plan.data.blocks.length > 0
              ? `약 ${formatMinutes(plan.data.totalMinutes)}`
              : null
          }
        >
          <Loaded query={plan} height={220} what="오늘의 학습">
            {(data) => <TodayPlan plan={data} start={start} />}
          </Loaded>
        </Card>
        <Card id="today-review" icon={Repeat} title="오늘의 복습" className="dashboard__review">
          <Loaded query={queue} height={220} what="오늘의 복습">
            {(data) => <ReviewCard queue={data} mastery={mastery.data} start={start} />}
          </Loaded>
        </Card>
        <ConceptMapCard
          query={mastery}
          weak={weak.data}
          openId={sheet?.id ?? null}
          onOpenConcept={openFromMap}
        />
        <Card
          id="course-progress"
          icon={BookOpen}
          title="과정 진도"
          className="dashboard__progress"
        >
          <Loaded query={mastery} height={140} what="과정 진도">
            {(data) => <CourseProgress mastery={data} />}
          </Loaded>
        </Card>
        <Card id="weak-concepts" icon={Crosshair} title="약점 개념" className="dashboard__weak">
          <Loaded query={weak} height={140} what="약점 개념">
            {(data) => <WeakConceptList weak={data} start={start} />}
          </Loaded>
        </Card>
      </div>
      <ConceptSheet
        concept={sheet}
        today={mastery.data?.date ?? null}
        onOpen={setSheet}
        onClose={() => {
          setSheet(null);
          const target = opener.current;
          opener.current = null;
          // After the drawer has unmounted (it would take the focus back to the page).
          setTimeout(() => target?.focus(), 0);
        }}
      />
    </div>
  );
}

function totalOf(counts: MasteryOverview['courses'][number]['stageCounts']): number {
  return Object.values(counts).reduce((s, n) => s + n, 0);
}

type Start = ReturnType<typeof useStartSet>;

function Card({
  id,
  icon: Icon,
  title,
  subtitle,
  badge,
  actions,
  className,
  children,
}: {
  id: string;
  icon: typeof Target;
  title: string;
  subtitle?: string | undefined;
  badge?: ReactNode;
  /** Controls at the right of the card header (the concept map's selects). */
  actions?: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`${cardClass} dashboard__card ${className}`} aria-labelledby={id}>
      <div className="dashboard__card-head">
        <h2 id={id} className="dashboard__card-title">
          <Icon size={20} aria-hidden="true" />
          {title}
          {subtitle && <span className="dashboard__card-subtitle">· {subtitle}</span>}
        </h2>
        {badge && <Badge>{badge}</Badge>}
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Card body: skeleton while loading (ui-ux.md 공통 상태), inline error with retry. */
function Loaded<T>({
  query,
  height,
  what,
  children,
}: {
  query: UseQueryResult<T>;
  height: number;
  what: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton height={height} />;
  if (query.isError) {
    return (
      <ErrorState
        variant="inline"
        title={`${what}을(를) 불러오지 못했어요`}
        description={query.error.message}
        action={<Button onClick={() => void query.refetch()}>다시 시도</Button>}
      />
    );
  }
  return <>{children(query.data)}</>;
}

// ── Greeting, goal ring and week ──

function Greeting({
  plan,
  goals,
  fresh,
}: {
  plan: DailyPlanView | undefined;
  goals: GoalStatus | undefined;
  fresh: boolean;
}) {
  const minutes = goals ? todayMinutes(goals) : (plan?.activeMinutesToday ?? 0);
  const goal = goals?.goal.dailyMinutes ?? plan?.goal.dailyMinutes ?? 30;
  const met = minutes >= goal;
  let title: string;
  let line: string;
  if (fresh) {
    title = '환영해요! 첫 단원부터 시작해 볼까요?';
    line = `하루 ${String(goal)}분 목표로 오늘의 학습을 준비했어요.`;
  } else if (met) {
    title = '오늘 목표를 채웠어요';
    line = '더 하고 싶다면 약점 집중을 추천해요.';
  } else if (minutes > 0) {
    title = `오늘 ${String(minutes)}분 공부했어요`;
    line = `오늘 목표 ${String(goal)}분까지 ${String(goal - minutes)}분 남았어요.`;
  } else {
    title = '다시 오셨네요';
    line =
      plan?.blocks[0]?.kind === 'review'
        ? '오늘은 복습부터 가볍게 시작해요.'
        : '오늘의 학습을 시작해 볼까요?';
  }
  return (
    <section className="dashboard__greeting" aria-label="오늘 현황">
      <div>
        <h1 className="dashboard__title" tabIndex={-1}>
          <span className="sr-only">대시보드: </span>
          {title}
        </h1>
        <p className="dashboard__line">{line}</p>
      </div>
      {goals && (
        <div className="dashboard__goal">
          <div className="dashboard__goal-ring">
            <GoalRing minutes={minutes} goal={goal} size={40} />
            <p className="tnum">
              <b>
                {minutes} / {goal}분
              </b>
              <span>오늘 목표{met ? ' 달성' : ''}</span>
            </p>
          </div>
          <WeekStrip week={goals.week} today={goals.date} />
          {goals.streakWeeks > 0 && (
            <p className="dashboard__streak tnum">주간 목표 연속 {goals.streakWeeks}주</p>
          )}
        </div>
      )}
    </section>
  );
}

// ── 오늘의 학습 ──

function TodayPlan({ plan, start }: { plan: DailyPlanView; start: Start }) {
  const pace = plan.pace && paceText(plan.pace);
  return (
    <div className="grid gap-4">
      {plan.mode === 'extra' && (
        <p className="text-fg-secondary type-small">
          <Check size={14} aria-hidden="true" className="mr-1 inline" />
          오늘 목표를 채웠어요. 더 하고 싶다면 아래를 이어서 해 보세요.
        </p>
      )}
      {plan.blocks.length === 0 ? (
        <p className="text-fg-secondary">
          오늘 계획할 학습이 없어요. <Link to="/courses">과정</Link>에서 새 단원을 골라 보세요.
        </p>
      ) : (
        <ol className="plan-list">
          {plan.blocks.map((block, i) => (
            <PlanItem
              key={`${block.kind}-${String(i)}`}
              block={block}
              n={i + 1}
              current={i === 0}
              start={start}
            />
          ))}
        </ol>
      )}
      {plan.later.length > 0 && (
        <details className="plan-later">
          <summary>시간이 남으면 ({plan.later.length})</summary>
          <ul>
            {plan.later.map((block, i) => (
              <li key={`${block.kind}-${String(i)}`}>
                {blockTitle(block)} <span className="text-fg-tertiary">· 약 {block.minutes}분</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {pace && plan.goal.targetDate && plan.goal.targetCourse && (
        <p className="plan-pace" data-attention={pace.attention || undefined}>
          <Clock size={16} aria-hidden="true" />
          <span>
            목표일 {formatLocalDate(plan.goal.targetDate)} · {plan.goal.targetCourse.title} ·{' '}
            {pace.text}
            {pace.attention && (
              <>
                {' '}
                <Link to="/settings/goals">목표 수정</Link>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}

function PlanItem({
  block,
  n,
  current,
  start,
}: {
  block: DailyPlanBlockView;
  n: number;
  current: boolean;
  start: Start;
}) {
  return (
    <li
      className="plan-item"
      data-current={current || undefined}
      aria-current={current ? 'step' : undefined}
    >
      <span className="plan-item__num" aria-hidden="true">
        {n}
      </span>
      <div className="min-w-0">
        <p className="plan-item__title">{blockTitle(block)}</p>
        <p className="plan-item__sub">
          약 {block.minutes}분 · {blockReason(block)}
        </p>
      </div>
      <BlockAction block={block} primary={current} start={start} />
    </li>
  );
}

function BlockAction({
  block,
  primary,
  start,
}: {
  block: DailyPlanBlockView;
  primary: boolean;
  start: Start;
}) {
  const variant = primary ? 'primary' : 'secondary';
  const size = primary ? 'md' : 'sm';
  const lesson = block.lesson;
  if ((block.kind === 'continue' || block.kind === 'new_lesson') && lesson) {
    const setId = lesson.status === 'practicing' ? lesson.practiceSetId : null;
    return (
      <Link
        to="/learn/$lessonId"
        params={{ lessonId: lesson.id }}
        search={setId ? { mode: 'practice', set: setId } : {}}
        className={`${buttonLink} pi-button--${variant} pi-button--${size}`}
      >
        {block.kind === 'continue' ? '이어서 학습' : '단원 시작'}
        {primary && <ArrowRight size={16} aria-hidden="true" />}
      </Link>
    );
  }
  if (block.kind === 'review') {
    return (
      <Button
        variant={variant}
        size={size}
        loading={start.pending === 'plan-review'}
        onClick={() => void start.start('plan-review', { kind: 'review' })}
      >
        복습 시작
      </Button>
    );
  }
  if (block.kind === 'weakness' && block.concepts.length > 0) {
    return (
      <Button
        variant={variant}
        size={size}
        loading={start.pending === 'plan-weakness'}
        onClick={() =>
          void start.start('plan-weakness', {
            kind: 'weakness',
            conceptIds: block.concepts.slice(0, 5).map((c) => c.id),
          })
        }
      >
        약점 집중 시작
      </Button>
    );
  }
  return null;
}

// ── 오늘의 복습 ──

function dayLabel(date: string, today: string): string {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '내일';
  return formatShortDate(date);
}

function ReviewCard({
  queue,
  mastery,
  start,
}: {
  queue: ReviewQueue;
  mastery: MasteryOverview | undefined;
  start: Start;
}) {
  const tiles = new Map(
    (mastery?.courses ?? []).flatMap((c) =>
      c.modules.flatMap((m) => m.concepts.map((t) => [t.id, t])),
    ),
  );
  if (queue.due.length === 0) {
    const upcoming = [...tiles.values()]
      .map((t) => t.nextReviewDate)
      .filter((d): d is string => d !== null && d > queue.date)
      .sort();
    const next = upcoming[0];
    return (
      <div className="grid gap-2">
        <p className="text-fg">오늘 복습할 개념이 없어요.</p>
        <p className="text-fg-secondary type-small">
          {next
            ? `다음 복습: ${dayLabel(next, queue.date)} ${String(upcoming.filter((d) => d === next).length)}개`
            : '연습한 개념은 잊을 즈음 다시 여기에 나와요.'}
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <p className="review-card__big tnum">
        {queue.due.length}개{' '}
        <small>개념 · 약 {Math.max(1, Math.round(queue.estimatedMinutes))}분</small>
      </p>
      <ul className="review-card__list">
        {queue.due.slice(0, 5).map((entry) => {
          const t = tiles.get(entry.conceptId);
          return (
            <li key={entry.conceptId}>
              {t && <MasteryIcon stage={t.stage} due decorative />}
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              {entry.overdue && <span className="type-caption text-fg-tertiary">예정일 지남</span>}
            </li>
          );
        })}
      </ul>
      {queue.due.length > 5 && (
        <p className="text-fg-tertiary type-small">외 {queue.due.length - 5}개</p>
      )}
      {queue.deferred.length > 0 && (
        <p className="text-fg-secondary type-small">
          시간이 모자라 {queue.deferred.length}개는 내일로 미뤘어요.
        </p>
      )}
      <Button
        loading={start.pending === 'review'}
        onClick={() => void start.start('review', { kind: 'review' })}
      >
        복습 시작
      </Button>
    </div>
  );
}

// ── 개념 지도 ──

type MapView = 'modules' | 'due' | 'weak';
const VIEW_LABELS: Readonly<Record<MapView, string>> = {
  modules: '모듈별',
  due: '복습 예정만',
  weak: '약점만',
};

/** The concept map card: course and view selects in the header, the map below. */
type OpenConcept = (concept: { id: string; title: string }) => void;

function ConceptMapCard({
  query,
  weak,
  openId,
  onOpenConcept,
}: {
  query: UseQueryResult<MasteryOverview>;
  weak: WeakConcepts | undefined;
  openId: string | null;
  onOpenConcept: OpenConcept;
}) {
  const [courseId, setCourseId] = useState<string | null>(null);
  const [view, setView] = useState<MapView>('modules');
  const mastery = query.data;
  const course = mastery?.courses.find((c) => c.id === courseId) ?? mastery?.courses[0];
  const controls = mastery && course && (
    <div className="concept-map__controls">
      {mastery.courses.length > 1 && (
        <Select
          label="과정"
          value={course.id}
          onValueChange={setCourseId}
          options={mastery.courses.map((c) => ({ value: c.id, label: c.title }))}
        />
      )}
      <Select
        label="보기"
        value={view}
        onValueChange={(v) => {
          setView(v as MapView);
        }}
        options={(Object.keys(VIEW_LABELS) as MapView[]).map((v) => ({
          value: v,
          label: VIEW_LABELS[v],
        }))}
      />
    </div>
  );
  return (
    <Card
      id="concept-map"
      icon={Layers}
      title="개념 지도"
      subtitle={course?.title}
      className="dashboard__map"
      actions={controls}
    >
      <Loaded query={query} height={200} what="개념 지도">
        {(data) =>
          course ? (
            <ConceptMap
              mastery={data}
              course={course}
              view={view}
              weak={weak}
              openId={openId}
              onOpenConcept={onOpenConcept}
            />
          ) : (
            <p className="text-fg-secondary">아직 학습 콘텐츠가 없어요.</p>
          )
        }
      </Loaded>
    </Card>
  );
}

function ConceptMap({
  mastery,
  course,
  view,
  weak,
  openId,
  onOpenConcept,
}: {
  mastery: MasteryOverview;
  course: MasteryOverview['courses'][number];
  view: MapView;
  weak: WeakConcepts | undefined;
  openId: string | null;
  onOpenConcept: OpenConcept;
}) {
  // "약점" marker: a confirmed misconception (ui-ux.md 숙련 단계 스케일). The "약점만" view also
  // shows the concepts the weakness ranking would practise next.
  const suggested = new Set(weak?.suggested ?? []);
  const confirmed = (t: (typeof course.modules)[number]['concepts'][number]) =>
    t.misconceptions.some((m) => m.status === 'confirmed');
  const isWeak = (t: (typeof course.modules)[number]['concepts'][number]) =>
    suggested.has(t.id) || confirmed(t);
  const fresh = course.stageCounts.not_started === totalOf(course.stageCounts);
  const rows = course.modules
    .map((m, i) => ({
      ...m,
      n: i + 1,
      shown: m.concepts.filter((t) =>
        view === 'due' ? t.reviewDue : view === 'weak' ? isWeak(t) : true,
      ),
    }))
    .filter((m) => m.shown.length > 0 || view === 'modules');
  return (
    <div className="grid gap-4">
      {fresh && view === 'modules' && (
        <p className="concept-map__hint">
          학습하면 여기가 채워져요. 단원을 읽고 문제를 풀면 개념마다 숙련 단계가 표시돼요.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-fg-secondary">
          {view === 'due' ? '오늘 복습할 개념이 없어요.' : '지금은 약점으로 보이는 개념이 없어요.'}
        </p>
      ) : (
        <div className="concept-map__rows">
          {rows.map((m) => (
            <section key={m.id} className="concept-map__row" aria-labelledby={`module-${m.id}`}>
              <h3 id={`module-${m.id}`} className="concept-map__label">
                {m.n}. {m.title}
                <small>
                  {m.lessons.completed} / {m.lessons.total}단원 완료
                </small>
              </h3>
              <ul className="concept-map__tiles">
                {m.shown.map((t) => (
                  <li key={t.id}>
                    <ConceptTile
                      tile={t}
                      weak={confirmed(t)}
                      today={mastery.date}
                      open={openId === t.id}
                      onOpen={() => {
                        onOpenConcept({ id: t.id, title: t.title });
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ul className="concept-map__legend" aria-label="범례">
        {(Object.keys(STAGE_NAMES) as (keyof typeof STAGE_NAMES)[]).map((stage) => (
          <li key={stage}>
            <MasteryIcon stage={stage} decorative />
            {STAGE_NAMES[stage]}
          </li>
        ))}
        <li>
          <MasteryIcon stage="practicing" due decorative />
          복습 예정
        </li>
        <li>
          <MasteryIcon stage="practicing" weak decorative />
          약점
        </li>
      </ul>
    </div>
  );
}

/**
 * ConceptTile (ui-ux.md 학습 특화 컴포넌트): stage icon with markers, the name (two lines at
 * most) and the next review. Hover shows the score; a click opens the concept detail sheet.
 */
export function ConceptTile({
  tile,
  weak,
  today,
  open,
  onOpen,
}: {
  tile: MasteryOverview['courses'][number]['modules'][number]['concepts'][number];
  weak: boolean;
  today: string;
  open: boolean;
  onOpen: () => void;
}) {
  const confirmed = tile.misconceptions.find((m) => m.status === 'confirmed');
  return (
    <button
      type="button"
      className="concept-tile"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      data-dim={tile.stage === 'not_started' || undefined}
      title={
        tile.stage === 'not_started'
          ? undefined
          : `숙련도 ${String(Math.round(tile.effective))}${confirmed ? ` · 오개념: ${confirmed.title}` : ''}`
      }
    >
      <MasteryIcon stage={tile.stage} due={tile.reviewDue} weak={weak} />
      <span className="concept-tile__title">{tile.title}</span>
      {tile.reviewDue ? (
        <span className="concept-tile__flag" data-kind="due">
          <Clock size={12} aria-hidden="true" />
          <span className="sr-only">오늘 복습할 차례예요</span>
        </span>
      ) : (
        tile.nextReviewDate && (
          <span className="concept-tile__next tnum">
            <span className="sr-only">다음 복습 </span>
            {dayLabel(tile.nextReviewDate, today)}
          </span>
        )
      )}
    </button>
  );
}

// ── 과정 진도 ──

const DIST_ORDER = ['mastered', 'proficient', 'practicing', 'introduced'] as const;

function CourseProgress({ mastery }: { mastery: MasteryOverview }) {
  if (mastery.courses.length === 0) return <p className="text-fg-secondary">아직 과정이 없어요.</p>;
  return (
    <ul className="course-progress">
      {mastery.courses.map((c) => {
        const pct =
          c.lessons.total === 0 ? 0 : Math.round((c.lessons.completed / c.lessons.total) * 100);
        const dist = DIST_ORDER.filter((s) => c.stageCounts[s] > 0)
          .map((s) => `${STAGE_NAMES[s]} ${String(c.stageCounts[s])}`)
          .join(' · ');
        return (
          <li key={c.id}>
            <ProgressRing value={pct} label={`${c.title} 단원 진도`} size={40} />
            <div className="min-w-0">
              <Link
                to="/courses/$courseId"
                params={{ courseId: c.id }}
                className="course-progress__name"
              >
                {c.title}
              </Link>
              <p className="text-fg-secondary type-small">
                {c.lessons.completed} / {c.lessons.total}단원 완료 · {dist || '아직 시작 전'}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── 약점 개념 ──

function WeakConceptList({ weak, start }: { weak: WeakConcepts; start: Start }) {
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set(weak.suggested);
  if (weak.concepts.length === 0) {
    return (
      <p className="text-fg-secondary">
        아직 약점이 없어요. 연습한 개념 중 숙련도가 낮거나 오개념이 보이는 개념이 여기에 모여요.
      </p>
    );
  }
  const shown = weak.concepts.slice(0, 5);
  return (
    <div className="grid gap-4">
      <ul className="weak-list">
        {shown.map((w) => {
          const prereq = w.prerequisites.find((p) => p.weak);
          const reasons = [
            `숙련도 ${String(Math.round(w.effective))}`,
            ...w.misconceptions.map(
              (m) => `오개념 ‘${m.title}’${m.status === 'confirmed' ? '' : '(의심)'}`,
            ),
            ...(w.consecutiveFailures >= 2
              ? [`최근 ${String(w.consecutiveFailures)}번 연속 틀림`]
              : []),
            ...(prereq ? [`선수 개념 ‘${prereq.concept.title}’부터 확인해요`] : []),
          ];
          return (
            <li key={w.concept.id}>
              <Checkbox
                label={
                  <span className="inline-flex items-center gap-2">
                    <MasteryIcon
                      stage={w.stage}
                      weak={w.misconceptions.some((m) => m.status === 'confirmed')}
                    />
                    {w.concept.title}
                  </span>
                }
                description={reasons.join(' · ')}
                checked={selected.has(w.concept.id)}
                onCheckedChange={(checked) => {
                  const next = new Set(selected);
                  if (checked === true) next.add(w.concept.id);
                  else next.delete(w.concept.id);
                  setPicked(next);
                }}
              />
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          disabled={selected.size === 0}
          loading={start.pending === 'weakness'}
          onClick={() =>
            void start.start('weakness', {
              kind: 'weakness',
              conceptIds: shown
                .map((w) => w.concept.id)
                .filter((id) => selected.has(id))
                .slice(0, 5),
            })
          }
        >
          약점 집중 시작{selected.size > 0 ? ` (${String(selected.size)}개 개념)` : ''}
        </Button>
      </div>
    </div>
  );
}
