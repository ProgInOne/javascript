import type { CourseProgressState, CourseProgressSummary } from '@proginone/shared';
import { Badge } from '@proginone/ui';
import { Check, Circle, CircleCheck, PencilLine } from 'lucide-react';

// Course and lesson progress marks shared by the course list and the course detail (D-083).

type LessonStatus = NonNullable<CourseProgressSummary['next']>['status'];

const STATE_LABELS: Record<CourseProgressState, string> = {
  not_started: '시작 전',
  in_progress: '진행 중',
  completed: '완료',
};

/** "시작 전" / "진행 중" / "완료" chip: text and (when done) a check, never color alone. */
export function CourseStateBadge({ state }: { state: CourseProgressState }) {
  return (
    <Badge
      variant={state === 'completed' ? 'success' : state === 'in_progress' ? 'brand' : 'neutral'}
      icon={state === 'completed' ? <Check size={14} /> : undefined}
      data-course-state={state}
    >
      {STATE_LABELS[state]}
    </Badge>
  );
}

/** "4단원 중 1단원 완료". */
export const completedText = (lessons: { total: number; completed: number }) =>
  `${String(lessons.total)}단원 중 ${String(lessons.completed)}단원 완료`;

/** Whole percent of completed lessons (0 for a course without lessons). */
export const completedPercent = (lessons: { total: number; completed: number }) =>
  lessons.total === 0 ? 0 : Math.round((lessons.completed / lessons.total) * 100);

/** Spoken and visible label of a lesson status; reading carries how much was read. */
export function lessonStatusLabel(status: LessonStatus, readProgress = 0): string {
  switch (status) {
    case 'completed':
      return '완료';
    case 'practicing':
      return '연습 중';
    case 'reading':
      return `읽는 중 ${String(Math.round(readProgress * 100))}%`;
    case 'not_started':
      return '시작 전';
  }
}

const RING = 18;
const STROKE = 2.5;

/**
 * The lesson row's status mark (20px): a check when completed, a pencil while practicing, a ring
 * filled to the read share while reading, an empty circle before starting. Each shape differs, and
 * the row carries the status as text too, so color is never the only cue.
 */
export function LessonStatusIcon({
  status,
  readProgress,
}: {
  status: LessonStatus;
  readProgress: number;
}) {
  const box = 'inline-flex size-5 shrink-0 items-center justify-center';
  if (status === 'completed') {
    return (
      <span className={`${box} text-(--color-feedback-correct-fg)`} aria-hidden="true">
        <CircleCheck size={20} />
      </span>
    );
  }
  if (status === 'practicing') {
    return (
      <span className={`${box} text-brand`} aria-hidden="true">
        <PencilLine size={18} />
      </span>
    );
  }
  if (status === 'reading') {
    const r = (RING - STROKE) / 2;
    const c = 2 * Math.PI * r;
    // At least a sliver, so a just-opened lesson still looks different from "시작 전".
    const share = Math.min(1, Math.max(0.08, readProgress));
    return (
      <span className={box} aria-hidden="true">
        <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="-rotate-90">
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-(--color-progress-track)"
          />
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - share)}
            className="stroke-(--color-progress-fill)"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className={`${box} text-fg-tertiary`} aria-hidden="true">
      <Circle size={18} />
    </span>
  );
}

/** A thin bar for places that already say the numbers in text (`aria-hidden`). */
export function MiniBar({ percent, className = '' }: { percent: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pi-progress inline-block h-1.5 ${className}`}
      data-percent={percent}
    >
      <span
        className="pi-progress__fill block"
        style={{ transform: `translateX(-${String(100 - percent)}%)` }}
      />
    </span>
  );
}
