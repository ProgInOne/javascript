import type { DailyPlanBlockView } from '@proginone/shared';

/** Block title in the 오늘의 학습 checklist (ui-ux.md 대시보드). */
export function blockTitle(block: DailyPlanBlockView): string {
  switch (block.kind) {
    case 'review':
      return `복습 ${String(block.concepts.length)}개 개념`;
    case 'continue':
      return `이어서 학습 · ${block.lesson?.title ?? '단원'}`;
    case 'new_lesson':
      return `새 단원 · ${block.lesson?.title ?? '다음 단원'}`;
    case 'weakness':
      return `약점 집중 · ${block.concepts.map((c) => c.title).join(', ')}`;
  }
}

/** Why the block is planned, in the learner's words (engine `DailyBlockReason`). */
export function blockReason(block: DailyPlanBlockView): string {
  const r = block.reason;
  switch (r.code) {
    case 'reviews_due':
      return r.overdueCount > 0
        ? `오늘 복습할 차례예요 · 예정일이 지난 개념 ${String(r.overdueCount)}개`
        : '잊을 즈음 다시 떠올리면 더 오래 기억해요';
    case 'reviews_over_budget':
      return `오늘 시간에 다 못 넣은 복습 ${String(r.count)}개`;
    case 'continue_lesson':
      return block.partial
        ? `남은 약 ${String(r.remainingMinutes)}분 중 오늘 할 만큼`
        : `남은 시간 약 ${String(r.remainingMinutes)}분`;
    case 'new_lesson':
      switch (r.why) {
        case 'first_lesson':
          return '첫 단원부터 시작해요';
        case 'nothing_in_progress':
          return '다음 단원을 시작할 차례예요';
        case 'pace_behind':
          return '목표일을 맞추려면 새 단원을 조금 더 나가야 해요';
        case 'pace_tight':
          return '목표일까지 빠듯해서 새 단원을 함께 해요';
      }
      break;
    case 'weak_concepts':
      return `숙련도가 낮은 개념을 짧게 연습해요 (가장 낮은 ${String(Math.round(r.topEffective))}점)`;
    case 'over_budget':
      return '오늘 목표 시간을 넘어요';
  }
  return '';
}
