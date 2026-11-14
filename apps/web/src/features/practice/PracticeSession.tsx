import type {
  AttemptResponse,
  MasteryChange,
  PracticeSetView,
  Remediation,
} from '@proginone/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { LEARNING_STATE_KEYS, practiceSetQuery, skipItem } from '../../api/queries.ts';
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
  // The latest relearning suggestion, shown above the problem until followed or declined.
  const [remediation, setRemediation] = useState<Remediation | null>(null);
  // Worked example stage of items appended for a suggestion ("풀이 예제 1/3").
  const [stages, setStages] = useState<ReadonlyMap<string, { stage: number; of: number }>>(
    new Map(),
  );
  const [skipError, setSkipError] = useState<string | null>(null);
  // The first item keeps the page's focus; later item changes move focus to the new prompt.
  const [navigated, setNavigated] = useState(false);
  const go = (i: number | null) => {
    setNavigated(true);
    onIndexChange(i);
  };
  const showSummary = index === null && set.status === 'completed';
  const current = index ?? (set.status === 'completed' ? null : firstIndex(set));
  const item = current === null ? undefined : set.items[current];

  /** The set with the items the engine added or replaced (fetched again when it changed). */
  const refreshSet = () => client.query({ ...practiceSetQuery(set.id), staleTime: 0 });

  const onAnswered = (res: AttemptResponse) => {
    client.setQueryData(practiceSetQuery(set.id).queryKey, (old) =>
      old ? applyAttemptToSet(old, res) : old,
    );
    if (res.adaptations.length > 0) void refreshSet();
    if (res.remediation) {
      const r = res.remediation;
      setRemediation(r);
      if (r.kind === 'worked_example') {
        setStages((old) => {
          const next = new Map(old);
          r.itemIds.forEach((id, i) => {
            next.set(id, { stage: (r.workedExampleStages[i] ?? i) + 1, of: 3 });
          });
          return next;
        });
      }
    }
    if (res.attempt.engineApplied) setChanges((c) => [...c, ...res.masteryChanges]);
    if (res.set.status === 'completed') {
      for (const queryKey of LEARNING_STATE_KEYS) void client.invalidateQueries({ queryKey });
    }
  };

  /** Opens the first item of the suggestion (already appended to the set, D-033). */
  const followRemediation = async () => {
    const r = remediation;
    if (!r) return;
    setRemediation(null);
    const fresh = await refreshSet().catch(() => set);
    const i = fresh.items.findIndex((it) => it.id === r.itemIds[0]);
    if (i >= 0) go(i);
  };

  /** Skips the current item; the server appends a follow-up and may complete the set. */
  const skip = async (itemId: string) => {
    setSkipError(null);
    try {
      const res = await skipItem(set.id, itemId);
      const fresh = await refreshSet();
      if (res.set.status === 'completed') {
        for (const queryKey of LEARNING_STATE_KEYS) void client.invalidateQueries({ queryKey });
        go(null);
        return;
      }
      const next = fresh.items.findIndex((it) => it.id === res.set.nextItemId);
      go(next >= 0 ? next : null);
    } catch (e) {
      setSkipError(e instanceof ApiRequestError ? e.message : '건너뛰지 못했어요.');
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
      {skipError && (
        <p role="alert" className="practice-error">
          {skipError}
        </p>
      )}
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
          remediation={remediation}
          onFollowRemediation={() => void followRemediation()}
          onDismissRemediation={() => {
            setRemediation(null);
          }}
          onSkip={() => skip(item.id)}
          workedExample={stages.get(item.id) ?? null}
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
