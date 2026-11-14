import type { PaceView } from '@proginone/shared';

/** "2027-03-31" → "2027년 3월 31일". */
export function formatLocalDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${String(y)}년 ${String(m)}월 ${String(d)}일`;
}

/** "2026-11-18" → "11/18". */
export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${String(m)}/${String(d)}`;
}

/**
 * The goal pace as a sentence (ui-ux.md 대시보드 "목표 페이스"). `behind` and `overdue` are shown
 * in amber (`attention`), never red or with warning icons.
 */
export function paceText(pace: PaceView): { text: string; attention: boolean } {
  const perDay = pace.suggestedDailyMinutes ?? Math.ceil(pace.requiredPerDay);
  switch (pace.status) {
    case 'on_track':
      return { text: '이 페이스면 목표일 전에 끝나요.', attention: false };
    case 'tight':
      return {
        text: `조금 빠듯해요. 하루 ${String(perDay)}분이면 맞출 수 있어요.`,
        attention: false,
      };
    case 'behind':
      return {
        text: `목표일을 맞추려면 하루 ${String(perDay)}분이 필요해요. 목표일을 ${formatLocalDate(pace.suggestedTargetDate)}로 옮겨도 돼요.`,
        attention: true,
      };
    case 'overdue':
      return { text: '목표일이 지났어요. 새 목표일을 정할까요?', attention: true };
  }
}
