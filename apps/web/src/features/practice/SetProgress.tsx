import type { PracticeSetView } from '@proginone/shared';
import { Check, Dot, Minus, RotateCw, X } from 'lucide-react';
import { ITEM_STATE_LABELS, itemState, type ItemState } from './model.ts';
import { addedItemLabel } from './Relearning.tsx';

const ICONS: Partial<Record<ItemState, typeof Check>> = {
  submitted: Dot,
  correct: Check,
  retried: RotateCw,
  wrong: X,
  skipped: Minus,
};

/**
 * SetProgress (ui-ux.md 연습 세트 진행 표시): one marker per item with state shown by shape and
 * text, plus "n / total". No timer. Markers move to that item.
 */
export function SetProgress({
  set,
  current,
  onSelect,
}: {
  set: PracticeSetView;
  /** 0-based current item, or null on the summary. */
  current: number | null;
  onSelect: (index: number) => void;
}) {
  const done = set.progress.answered + set.progress.skipped;
  return (
    <nav
      className="set-progress"
      aria-label={set.kind === 'assessment' ? '평가 진행' : '연습 진행'}
    >
      <ol className="set-progress__list">
        {set.items.map((item, i) => {
          const state = itemState(item);
          const Icon = ICONS[state];
          const isCurrent = i === current;
          const added = addedItemLabel(item.reason);
          return (
            <li key={item.id}>
              <button
                type="button"
                className="set-progress__dot"
                data-state={state}
                data-added={added ? '' : undefined}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`문제 ${String(i + 1)}: ${ITEM_STATE_LABELS[state]}${added ? ` (${added})` : ''}`}
                onClick={() => {
                  onSelect(i);
                }}
              >
                {Icon && <Icon size={10} strokeWidth={3} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
      <span className="set-progress__count" aria-live="polite">
        <span className="sr-only">푼 문제 </span>
        {done} / {set.items.length}
      </span>
    </nav>
  );
}
