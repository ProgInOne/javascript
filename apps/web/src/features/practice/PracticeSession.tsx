import type { AttemptResponse, MasteryChange, PracticeSetView } from '@proginone/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { LEARNING_STATE_KEYS, practiceSetQuery } from '../../api/queries.ts';
import { applyAttemptToSet, mergeMasteryChanges, nextPendingIndex } from './model.ts';
import { PracticeItem } from './PracticeItem.tsx';
import { SetProgress } from './SetProgress.tsx';
import { SetSummary } from './SetSummary.tsx';

export interface PracticeSessionProps {
  set: PracticeSetView;
  /** 0-based item from the URL (`i` is 1-based), or null for the summary. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
  /** Page heading (h1), e.g. "첫 프로그램 연습" or "오늘의 복습". */
  heading: string;
  /** Lesson title for the completion heading; null for review sets. */
  lessonTitle: string | null;
  summaryActions: (set: PracticeSetView) => ReactNode;
  /** Extra controls at the end of the session bar (the review screen's tutor button). */
  barActions?: ReactNode;
}

/**
 * A practice set in progress (ui-ux.md 실습 모드): progress markers, the current item, and the
 * completion summary. Shared by lesson practice and review sets.
 */
export function PracticeSession({
  set,
  index,
  onIndexChange,
  heading,
  lessonTitle,
  summaryActions,
  barActions,
}: PracticeSessionProps) {
  const client = useQueryClient();
  const [changes, setChanges] = useState<MasteryChange[]>([]);
  // The first item keeps the page's focus; later item changes move focus to the new prompt.
  const [navigated, setNavigated] = useState(false);
  const go = (i: number | null) => {
    setNavigated(true);
    onIndexChange(i);
  };
  const showSummary = index === null && set.status === 'completed';
  const current = index ?? (set.status === 'completed' ? null : firstIndex(set));
  const item = current === null ? undefined : set.items[current];

  const onAnswered = (res: AttemptResponse) => {
    client.setQueryData(practiceSetQuery(set.id).queryKey, (old) =>
      old ? applyAttemptToSet(old, res) : old,
    );
    if (res.attempt.engineApplied) setChanges((c) => [...c, ...res.masteryChanges]);
    if (res.set.status === 'completed') {
      for (const queryKey of LEARNING_STATE_KEYS) void client.invalidateQueries({ queryKey });
    }
  };

  return (
    <div className="practice-session">
      <div className="practice-session__bar">
        <h1 className="practice-session__heading" tabIndex={-1}>
          {heading}
        </h1>
        <SetProgress set={set} current={showSummary ? null : current} onSelect={go} />
        {barActions}
      </div>
      {showSummary || !item || current === null ? (
        <SetSummary
          set={set}
          title={lessonTitle}
          changes={mergeMasteryChanges(changes)}
          actions={summaryActions(set)}
        />
      ) : (
        <PracticeItem
          key={item.id}
          set={set}
          item={item}
          index={current}
          hideConceptUntilGraded={set.kind === 'review'}
          autoFocus={navigated}
          contextTitle={heading}
          onAnswered={onAnswered}
          onNavigate={go}
          nextPending={nextPendingIndex(set, current)}
          onShowSummary={() => {
            go(null);
          }}
        />
      )}
    </div>
  );
}

function firstIndex(set: PracticeSetView): number {
  const i = set.items.findIndex((item) => item.id === set.nextItemId);
  return i < 0 ? 0 : i;
}
