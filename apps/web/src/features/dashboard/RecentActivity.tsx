import type { RecentActivity, RecentActivityList } from '@proginone/shared';
import { Badge } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import { formatShortDate } from '../goals/pace.ts';

type PracticeActivity = Extract<RecentActivity, { type: 'practice' }>;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "오늘 14:20", "어제 14:20", "11/11": the day from the learner-local dates the server computed
 * (they respect the learner's day start), the time from the local clock.
 */
export function activityWhen(item: { at: number; date: string }, today: string): string {
  const at = new Date(item.at);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (item.date === today) return `오늘 ${time}`;
  const days = Math.round((Date.parse(today) - Date.parse(item.date)) / 86_400_000);
  if (days === 1) return `어제 ${time}`;
  return formatShortDate(item.date);
}

function conceptNames(item: PracticeActivity): string {
  const names = item.concepts.map((c) => c.title).join(', ');
  const more = item.conceptCount - item.concepts.length;
  return more > 0 ? `${names} 외 ${String(more)}개` : names;
}

/** What the set was, in the learner's words ("반복문 연습", "복습 3개 개념", "약점 집중: …"). */
export function activityTitle(item: PracticeActivity): string {
  const lesson = item.lesson?.title ?? '';
  switch (item.setKind) {
    case 'lesson':
      return `${lesson} 연습`;
    case 'extra':
      return `${lesson} 한 번 더 연습`;
    case 'assessment':
      return `${lesson} 단원 평가`;
    case 'review':
      return item.conceptCount > 0 ? `복습 ${String(item.conceptCount)}개 개념` : '복습';
    case 'weakness':
      return item.conceptCount > 0 ? `약점 집중: ${conceptNames(item)}` : '약점 집중';
    case 'remedial':
      return lesson ? `${lesson} 재학습` : '재학습';
    case 'diagnostic':
      return '진단';
    case 'custom':
      return lesson ? `${lesson} 맞춤 연습` : '맞춤 연습';
  }
}

/**
 * The numbers of a set. An assessment in progress shows only how many items were answered: its
 * results stay hidden until it ends (the server sends `correct: null`).
 */
export function activityDetails(item: PracticeActivity): string {
  const parts: string[] = [];
  if (item.setKind === 'assessment') {
    if (item.assessment) {
      parts.push(`정답 ${String(item.correct ?? 0)}/${String(item.total)}`);
      parts.push(item.assessment.passed ? '통과' : '통과 기준 미달');
    } else {
      parts.push(`${String(item.answered)}/${String(item.total)}문항 답함`);
    }
  } else {
    parts.push(`${String(item.answered)}문제`);
    if (item.correct !== null) parts.push(`정답 ${String(item.correct)}`);
  }
  if (item.stageUps) parts.push(`숙련 상승 ${String(item.stageUps)}`);
  if (item.status === 'active') parts.push('진행 중');
  if (item.status === 'abandoned') parts.push('중단');
  return parts.join(' · ');
}

/**
 * 최근 활동 (ui-ux.md 대시보드 "최근 5개 세션 요약", FR-DASH-01, D-061): one row per practice set
 * (lesson practice, review, weakness focus, assessment, …) and per lesson completed without a set,
 * newest first.
 */
export function RecentActivityList({ data }: { data: RecentActivityList }) {
  if (data.items.length === 0) {
    return (
      <p className="text-fg-secondary">
        아직 활동이 없어요. 연습 문제를 풀거나 복습을 하면 여기에 최근 활동이 쌓여요.
      </p>
    );
  }
  return (
    <ol className="recent-activity">
      {data.items.map((item) => (
        <li key={`${item.type}-${item.id}`} className="recent-activity__row">
          <span className="recent-activity__when tnum">{activityWhen(item, data.date)}</span>
          {item.type === 'lesson' ? (
            <span className="recent-activity__body">
              <span className="recent-activity__title">
                <Link to="/learn/$lessonId" params={{ lessonId: item.lesson.id }}>
                  {item.lesson.title}
                </Link>{' '}
                단원 완료
              </span>
            </span>
          ) : (
            <span className="recent-activity__body">
              <span className="recent-activity__title">
                {activityTitle(item)}
                {item.lessonCompleted && (
                  <Badge variant="success" className="ml-2">
                    단원 완료
                  </Badge>
                )}
              </span>
              <span className="recent-activity__details">{activityDetails(item)}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
