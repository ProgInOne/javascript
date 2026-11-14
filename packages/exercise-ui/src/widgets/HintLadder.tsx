import { Button, Dialog } from '@proginone/ui';
import { Eye, Lightbulb, Lock } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { InlineText } from '../text/InlineText.tsx';
import { Kbd } from './Kbd.tsx';
import { ariaShortcut, modKeyLabel } from './shortcuts.ts';

/** Step names from D-010 (방향 → 핵심 개념 → 단계별 안내). */
export const HINT_STEP_LABELS = ['방향', '핵심 개념', '단계별 안내'] as const;

export interface HintLadderProps {
  /** Authored hints in ladder order (exactly 3 for authored exercises). */
  hints: readonly string[];
  /** Number of hints already opened (controlled; the server records hint usage). */
  revealed: number;
  /** Opens hint `level` (1-based, always `revealed + 1`). Bind `⌘.` to the same handler. */
  onReveal: (level: number) => void;
  /**
   * Opens the answer after confirmation. Omit to hide "정답 보기" (e.g. no answer available).
   * The button is enabled only after the last hint (D-010).
   */
  onRevealAnswer?: () => void;
  /** Whether the answer has been revealed. */
  answerRevealed?: boolean;
  /** Answer content shown once revealed (reference solution, correct option, explanation). */
  answer?: ReactNode;
  /** Assessment context: everything is locked until the set ends (D-023). */
  locked?: boolean;
  /** A hint or answer request is in flight. */
  pending?: boolean;
  /** Heading level of the "힌트" title. Default 3. */
  headingLevel?: 2 | 3 | 4;
  /** Renders hint text. Default: plain text with Markdown code spans. */
  renderText?: (text: string) => ReactNode;
  /**
   * Shown after the opened hints, e.g. an "AI에게 이 단계 다시 설명받기" action (same level,
   * ui-ux.md 힌트 사다리). Rendered only while at least one hint is open.
   */
  afterHints?: ReactNode;
}

const LOCKED_REASON = '평가가 끝나면 열려요';

/**
 * Hint ladder (docs/design/ui-ux.md#힌트-사다리): hints open one step at a time and stay open;
 * "정답 보기" unlocks after the last step and asks for confirmation.
 */
export function HintLadder({
  hints,
  revealed,
  onReveal,
  onRevealAnswer,
  answerRevealed = false,
  answer,
  locked = false,
  pending = false,
  headingLevel = 3,
  renderText = defaultRenderText,
  afterHints,
}: HintLadderProps) {
  const headingId = useId();
  const lockedId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const total = hints.length;
  const shown = Math.min(Math.max(revealed, 0), total);
  const next = shown + 1;
  const allShown = shown >= total;
  const Heading = `h${headingLevel}` as const;
  const lockedProps = locked
    ? { 'aria-disabled': true as const, 'aria-describedby': lockedId }
    : {};

  return (
    <section className="pi-ex-hints" aria-labelledby={headingId}>
      <Heading id={headingId} className="pi-ex-hints__title">
        <Lightbulb size={16} aria-hidden="true" />
        힌트
      </Heading>

      {shown > 0 && (
        <ol className="pi-ex-hints__list">
          {hints.slice(0, shown).map((hint, index) => (
            // Hints never reorder or disappear, so the index is a stable key.
            <li key={index} className="pi-ex-hints__item">
              <span className="pi-ex-hints__step">
                <span className="pi-ex-hints__number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="sr-only">{index + 1}단계 </span>
                {HINT_STEP_LABELS[index] ?? `${index + 1}단계`}
              </span>
              <div className="pi-ex-hints__text">{renderText(hint)}</div>
            </li>
          ))}
        </ol>
      )}

      {shown > 0 && afterHints}

      {locked && (
        <p id={lockedId} className="pi-ex-hints__note">
          <Lock size={14} aria-hidden="true" />
          {LOCKED_REASON}
        </p>
      )}

      {!allShown && (
        <div className="pi-ex-hints__actions">
          <Button
            size="sm"
            loading={pending}
            aria-keyshortcuts={ariaShortcut('.')}
            {...lockedProps}
            onClick={() => {
              if (!locked && !pending) onReveal(next);
            }}
          >
            힌트 {next}/{total} 보기
            <Kbd keys={[modKeyLabel(), '.']} />
          </Button>
          {!locked && (
            <p className="pi-ex-hints__note">힌트를 볼수록 이 문제의 숙련도 반영이 조금 줄어요.</p>
          )}
        </div>
      )}

      {onRevealAnswer && !answerRevealed && (
        <div className="pi-ex-hints__actions">
          <Button
            size="sm"
            variant="ghost"
            icon={<Eye size={16} aria-hidden="true" />}
            disabled={!allShown && !locked}
            {...lockedProps}
            onClick={() => {
              if (!locked && allShown) setConfirmOpen(true);
            }}
          >
            정답 보기
          </Button>
          {!allShown && !locked && (
            <p className="pi-ex-hints__note">힌트를 모두 본 뒤에 볼 수 있어요.</p>
          )}
        </div>
      )}

      {answerRevealed && (
        <div className="pi-ex-hints__answer">
          <p className="pi-ex-hints__answer-title">정답</p>
          {answer}
          <p className="pi-ex-hints__note">정답을 보지 않고 같은 문제를 직접 다시 풀어 보세요.</p>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="정답을 볼까요?"
        description="정답을 보면 이 문제는 나중에 비슷한 문제로 다시 나와요."
        footer={
          <>
            <Button
              onClick={() => {
                setConfirmOpen(false);
              }}
            >
              조금 더 해볼게요
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmOpen(false);
                onRevealAnswer?.();
              }}
            >
              정답 보기
            </Button>
          </>
        }
      />
    </section>
  );
}

function defaultRenderText(text: string): ReactNode {
  return <InlineText text={text} />;
}
