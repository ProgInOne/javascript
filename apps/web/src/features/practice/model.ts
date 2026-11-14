import type {
  AttemptResponse,
  MasteryChange,
  MasteryStage,
  PracticeItemView,
  PracticeSetView,
} from '@proginone/shared';

/** Stage names from the glossary (ui-ux.md 마이크로카피 원칙 6). */
export const STAGE_LABELS: Readonly<Record<MasteryStage, string>> = {
  not_started: '미학습',
  introduced: '입문',
  practicing: '연습 중',
  proficient: '숙련',
  mastered: '숙달',
};

export const TYPE_LABELS: Readonly<Record<string, string>> = {
  mcq_single: '객관식',
  mcq_multi: '복수 선택',
  true_false: '참/거짓',
  fill_blank: '빈칸 채우기',
  predict_output: '실행 결과 예측',
  parsons: '코드 순서 배열',
  find_bug_line: '오류 줄 찾기',
  implement_function: '함수 구현',
  fix_bug: '버그 수정',
  web_task: '웹 실습',
};

/** Types worked on in the editor (two-column layout, confidence on the first submission only). */
export const CODE_TYPES = new Set(['implement_function', 'fix_bug', 'web_task']);

export type ItemState = 'pending' | 'correct' | 'retried' | 'wrong' | 'skipped';

/** SetProgress state of an item (ui-ux.md 학습 특화 컴포넌트). */
export function itemState(item: PracticeItemView): ItemState {
  if (item.status === 'skipped') return 'skipped';
  if (item.status === 'pending' || item.lastOutcome === null) return 'pending';
  if (item.lastOutcome === 'correct') return item.attempts > 1 ? 'retried' : 'correct';
  return 'wrong';
}

export const ITEM_STATE_LABELS: Readonly<Record<ItemState, string>> = {
  pending: '아직 풀지 않음',
  correct: '정답',
  retried: '다시 풀어 정답',
  wrong: '정답 아님',
  skipped: '건너뜀',
};

/** Folds an attempt response into the cached set view. */
export function applyAttemptToSet(set: PracticeSetView, res: AttemptResponse): PracticeSetView {
  return {
    ...set,
    status: res.set.status,
    progress: res.set.progress,
    nextItemId: res.set.nextItemId,
    result: res.set.result ?? set.result,
    completedAt: res.set.status === 'completed' ? (set.completedAt ?? Date.now()) : set.completedAt,
    items: set.items.map((item) =>
      item.id === res.item.id
        ? {
            ...item,
            status: res.item.status,
            attempts: res.item.attempts,
            lastOutcome: res.attempt.engineApplied ? res.attempt.outcome : item.lastOutcome,
          }
        : item,
    ),
  };
}

/** Index of the next pending item after `from` (wrapping), or null when none is left. */
export function nextPendingIndex(set: PracticeSetView, from: number): number | null {
  const n = set.items.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (set.items[i]?.status === 'pending') return i;
  }
  return null;
}

/** First `before` and last `after` per concept over the session's attempts. */
export function mergeMasteryChanges(changes: readonly MasteryChange[]): MasteryChange[] {
  const merged = new Map<string, MasteryChange>();
  for (const change of changes) {
    const first = merged.get(change.conceptId);
    merged.set(
      change.conceptId,
      first
        ? { ...change, scoreBefore: first.scoreBefore, stageBefore: first.stageBefore }
        : change,
    );
  }
  return [...merged.values()];
}
