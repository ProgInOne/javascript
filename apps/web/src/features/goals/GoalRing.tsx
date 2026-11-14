import type { GoalStatus, WeekSummaryView } from '@proginone/shared';
import { Check } from 'lucide-react';

/** Today's active minutes in a goal status (the week contains today). */
export function todayMinutes(status: GoalStatus): number {
  return status.week.days.find((d) => d.date === status.date)?.activeMinutes ?? 0;
}

export interface GoalRingProps {
  minutes: number;
  goal: number;
  /** 20px in the header chip, 40px on the dashboard. */
  size?: 20 | 40;
  className?: string;
}

/**
 * GoalRing (ui-ux.md 학습 특화 컴포넌트, 목표 달성 표현): today's minutes against the daily goal.
 * Reaching the goal fills the ring and adds a check, nothing more. Decorative: the caller shows
 * "18 / 30분" as text next to it.
 */
export function GoalRing({ minutes, goal, size = 20, className }: GoalRingProps) {
  const ratio = goal > 0 ? Math.min(1, minutes / goal) : 0;
  const met = goal > 0 && minutes >= goal;
  const stroke = size <= 20 ? 3 : 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <span
      className={`goal-ring ${className ?? ''}`}
      data-met={met || undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="goal-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
        />
        {ratio > 0 && (
          <circle
            className="goal-ring__fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        )}
      </svg>
      {met && <Check className="goal-ring__check" size={size <= 20 ? 11 : 18} strokeWidth={3} />}
    </span>
  );
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;

/**
 * WeekStrip (FR-GOAL-04): Monday to Sunday, studied days filled, today outlined, and the weekly
 * goal as "n / m일" (✓ once reached). No streak warnings (ui-ux.md 목표 달성 표현).
 */
export function WeekStrip({
  week,
  today,
  compact = false,
}: {
  week: WeekSummaryView;
  today: string;
  compact?: boolean;
}) {
  return (
    <div
      className="week-strip"
      data-compact={compact || undefined}
      role="group"
      aria-label={`이번 주 학습 현황: 목표 ${week.weeklyDays}일 중 ${week.studiedDays}일`}
    >
      <ol className="week-strip__days">
        {week.days.map((day, i) => {
          const isToday = day.date === today;
          const future = day.date > today;
          return (
            <li
              key={day.date}
              className="week-strip__day"
              data-studied={day.studied || undefined}
              data-today={isToday || undefined}
            >
              <span className="week-strip__dot" aria-hidden="true">
                {day.studied && <Check size={12} strokeWidth={3} />}
              </span>
              <span aria-hidden="true">{WEEKDAYS[i]}</span>
              <span className="sr-only">
                {`${WEEKDAYS[i]}요일${isToday ? '(오늘)' : ''}: ${
                  day.studied ? `${day.activeMinutes}분 학습` : future ? '아직' : '쉬었어요'
                }`}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="week-strip__summary" aria-hidden="true">
        이번 주
        <b className="tnum">
          {week.studiedDays} / {week.weeklyDays}일{week.achieved && ' ✓'}
        </b>
      </div>
    </div>
  );
}
