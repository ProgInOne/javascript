import { Popover } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { goalsQuery } from '../../api/queries.ts';
import { GoalRing, todayMinutes, WeekStrip } from './GoalRing.tsx';

/**
 * The header's small GoalRing "◔ 18/30분" (ui-ux.md 전역 내비게이션). Opens this week's strip in a
 * popover. Hidden until the goal status has loaded (and when it fails: the header stays usable).
 */
export function HeaderGoal() {
  // Refetched every minute: heartbeats move today's minutes while the app is open.
  const { data } = useQuery({ ...goalsQuery, refetchInterval: 60_000 });
  if (!data) return null;
  const minutes = todayMinutes(data);
  const goal = data.goal.dailyMinutes;
  const met = minutes >= goal;
  return (
    <Popover
      label="이번 주 학습 현황"
      trigger={
        <button type="button" className="goal-chip">
          <GoalRing minutes={minutes} goal={goal} size={20} />
          {/* The visible text is part of the name (WCAG 2.5.3). */}
          <span className="sr-only">오늘 목표</span>{' '}
          <span className="tnum">
            {minutes} / {goal}분
          </span>
          {met && <span className="sr-only">, 달성</span>}
        </button>
      }
    >
      <div className="grid gap-4">
        <p className="font-semibold text-heading">
          {met ? `오늘 목표 ${goal}분을 채웠어요.` : `오늘 ${goal}분 중 ${minutes}분 공부했어요.`}
        </p>
        <WeekStrip week={data.week} today={data.date} compact />
        {data.streakWeeks > 0 && (
          <p className="text-fg-secondary type-small">주간 목표 연속 {data.streakWeeks}주</p>
        )}
        <Link to="/settings/goals" className="type-small">
          목표 바꾸기
        </Link>
      </div>
    </Popover>
  );
}
