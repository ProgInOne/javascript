import type {
  CheckResult,
  FeedbackItem,
  ParsonsAnswer,
  ParsonsPublicSpec,
} from '@proginone/exercise-kit';
import {
  ArrowDown,
  ArrowUp,
  Check,
  IndentDecrease,
  IndentIncrease,
  Plus,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@proginone/ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { RendererBaseProps } from '@proginone/exercise-ui';
import { CheckList } from '../widgets/CheckList.tsx';

export interface ParsonsProps extends RendererBaseProps<ParsonsPublicSpec, ParsonsAnswer> {
  /** Grader feedback: items targeting `block:<id>` mark that answer line (in place / indent). */
  feedback?: readonly FeedbackItem[];
  /** Run-graded exercises: per-check results for the test list. */
  checkResults?: readonly CheckResult[] | null;
}

/** Deepest indent the controls offer (the answer schema allows up to 8). */
export const PARSONS_UI_MAX_INDENT = 6;
const DRAG_TYPE = 'application/x-proginone-block';

type Item = ParsonsAnswer['order'][number];

/**
 * `parsons` (docs/design/content-and-exercises.md#parsons-코드-순서-배열): two columns, "코드 조각"
 * (unused blocks) and "내 답안" (the program being built).
 *
 * Keyboard first (WCAG 2.5.7: dragging is only an enhancement):
 * - a block button adds that block to the end of the answer (`Enter`/`Space`);
 * - the answer is one tab stop (a listbox): `↑`/`↓` select a line, `Alt+↑`/`Alt+↓` move it,
 *   `Alt+→`/`Alt+←` (or `]`/`[`) change its indent, `Delete`/`Backspace` return it to the blocks;
 * - the toolbar buttons under the answer do the same for the selected line.
 * Every change is announced in a polite live region.
 */
export function Parsons({
  spec,
  value,
  onChange,
  disabled = false,
  labelledBy,
  feedback = [],
  checkResults,
}: ParsonsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const bankRef = useRef<HTMLElement>(null);
  /** Where focus goes after a change removes the focused control from the page. */
  const focusAfter = useRef<{ bank: number } | 'list' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const blocks = new Map(spec.blocks.map((b) => [b.id, b]));
  const order = value.order.filter((item) => blocks.has(item.id));
  const usedIds = new Set(order.map((item) => item.id));
  const bank = spec.blocks.filter((b) => !usedIds.has(b.id));
  const selectedIndex = order.findIndex((item) => item.id === selected);
  const current = selectedIndex >= 0 ? selectedIndex : order.length > 0 ? 0 : -1;
  const codeOf = (id: string) => blocks.get(id)?.code ?? '';
  const marks = new Map<string, FeedbackItem>();
  for (const item of feedback) {
    if (item.target?.startsWith('block:')) marks.set(item.target.slice('block:'.length), item);
  }

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    const buttons = bankRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [];
    const button =
      target === 'list' ? undefined : buttons[Math.min(target.bank, buttons.length - 1)];
    if (button) button.focus();
    else listRef.current?.focus();
  });

  const commit = (next: Item[], message: string, focusId: string | null = selected) => {
    if (disabled) return;
    onChange({ order: next });
    setAnnouncement(message);
    setSelected(focusId);
  };

  const add = (id: string, at = order.length) => {
    const next = [...order];
    next.splice(at, 0, { id, indent: at > 0 ? (order[at - 1]?.indent ?? 0) : 0 });
    commit(next, `"${codeOf(id)}"을(를) 답안 ${at + 1}번째 줄에 놓았어요.`, id);
  };

  const remove = (index: number) => {
    const item = order[index];
    if (!item) return;
    const next = order.filter((_, i) => i !== index);
    const neighbor = next[Math.min(index, next.length - 1)]?.id ?? null;
    commit(next, `"${codeOf(item.id)}"을(를) 코드 조각으로 돌려놓았어요.`, neighbor);
    // Keep focus in the answer; when it is empty, go to the returned block.
    if (next.length > 0) focusAfter.current = 'list';
    else focusAfter.current = { bank: spec.blocks.length };
  };

  const move = (index: number, delta: number) => {
    const to = index + delta;
    const item = order[index];
    if (!item || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(index, 1);
    next.splice(to, 0, item);
    commit(next, `${to + 1}번째 줄로 옮겼어요.`, item.id);
  };

  const indent = (index: number, delta: number) => {
    const item = order[index];
    if (!item) return;
    const level = Math.min(PARSONS_UI_MAX_INDENT, Math.max(0, item.indent + delta));
    if (level === item.indent) return;
    const next = order.map((it, i) => (i === index ? { ...it, indent: level } : it));
    commit(next, `들여쓰기 ${level}단계`, item.id);
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (disabled || current < 0) return;
    const key = event.key;
    const alt = event.altKey;
    let handled = true;
    if (key === 'ArrowUp' && alt) move(current, -1);
    else if (key === 'ArrowDown' && alt) move(current, 1);
    else if ((key === 'ArrowRight' && alt) || key === ']') indent(current, 1);
    else if ((key === 'ArrowLeft' && alt) || key === '[') indent(current, -1);
    else if (key === 'ArrowUp') setSelected(order[Math.max(0, current - 1)]?.id ?? null);
    else if (key === 'ArrowDown')
      setSelected(order[Math.min(order.length - 1, current + 1)]?.id ?? null);
    else if (key === 'Home') setSelected(order[0]?.id ?? null);
    else if (key === 'End') setSelected(order[order.length - 1]?.id ?? null);
    else if (key === 'Delete' || key === 'Backspace') remove(current);
    else handled = false;
    if (handled) event.preventDefault();
  };

  // ── Drag and drop (pointer enhancement) ──
  const dragStart = (event: DragEvent, id: string) => {
    event.dataTransfer.setData(DRAG_TYPE, id);
    event.dataTransfer.effectAllowed = 'move';
  };
  const allowDrop = (event: DragEvent) => {
    if (!disabled && event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
  };
  const dropInAnswer = (event: DragEvent, at: number) => {
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (!id || !blocks.has(id) || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const from = order.findIndex((item) => item.id === id);
    if (from < 0) {
      add(id, at);
      return;
    }
    const item = order[from];
    if (!item) return;
    const next = [...order];
    next.splice(from, 1);
    const target = from < at ? at - 1 : at;
    next.splice(target, 0, item);
    commit(next, `${target + 1}번째 줄로 옮겼어요.`, id);
  };
  const dropInBank = (event: DragEvent) => {
    const id = event.dataTransfer.getData(DRAG_TYPE);
    const index = order.findIndex((item) => item.id === id);
    if (index < 0 || disabled) return;
    event.preventDefault();
    remove(index);
  };

  const bankId = `${baseId}-bank`;
  const answerLabelId = `${baseId}-answer`;
  const keysId = `${baseId}-keys`;
  const currentItem = current >= 0 ? order[current] : undefined;

  return (
    <div
      className="pi-ex-parsons"
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : '코드 순서 배열'}
    >
      <p className="pi-ex-parsons__note">
        필요 없는 조각이 섞여 있을 수 있어요.
        {spec.gradeIndent && ' 들여쓰기도 맞춰 주세요.'}
      </p>
      <div className="pi-ex-parsons__columns">
        <section
          ref={bankRef}
          className="pi-ex-parsons__column"
          aria-labelledby={bankId}
          onDragOver={allowDrop}
          onDrop={dropInBank}
        >
          <h3 id={bankId} className="pi-ex-parsons__heading">
            코드 조각
          </h3>
          {bank.length === 0 ? (
            <p className="pi-ex-parsons__empty">모든 조각을 답안에 놓았어요.</p>
          ) : (
            <ul className="pi-ex-parsons__bank">
              {bank.map((block, bankIndex) => (
                <li key={block.id}>
                  <button
                    type="button"
                    className="pi-ex-parsons__block"
                    draggable={!disabled}
                    disabled={disabled}
                    aria-describedby={`${baseId}-add-hint`}
                    onDragStart={(event) => {
                      dragStart(event, block.id);
                    }}
                    onClick={() => {
                      add(block.id);
                      focusAfter.current = { bank: bankIndex };
                    }}
                  >
                    <Plus size={14} aria-hidden="true" className="pi-ex-parsons__add-icon" />
                    <code>{block.code}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p id={`${baseId}-add-hint`} className="sr-only">
            누르면 답안 끝에 놓아요.
          </p>
        </section>
        <section className="pi-ex-parsons__column" aria-labelledby={answerLabelId}>
          <h3 id={answerLabelId} className="pi-ex-parsons__heading">
            내 답안
          </h3>
          <ul
            ref={listRef}
            role="listbox"
            aria-labelledby={answerLabelId}
            aria-describedby={keysId}
            aria-activedescendant={currentItem ? `${baseId}-line-${currentItem.id}` : undefined}
            aria-disabled={disabled || undefined}
            tabIndex={order.length > 0 ? 0 : -1}
            className="pi-ex-parsons__answer"
            data-empty={order.length === 0 || undefined}
            onKeyDown={onListKey}
            onDragOver={allowDrop}
            onDrop={(event) => {
              dropInAnswer(event, order.length);
            }}
          >
            {order.map((item, index) => {
              const mark = marks.get(item.id);
              const isCurrent = index === current && !disabled;
              return (
                <li
                  key={item.id}
                  id={`${baseId}-line-${item.id}`}
                  role="option"
                  aria-selected={isCurrent}
                  className="pi-ex-parsons__line"
                  data-current={isCurrent || undefined}
                  data-state={mark?.level}
                  draggable={!disabled}
                  onDragStart={(event) => {
                    dragStart(event, item.id);
                  }}
                  onDragOver={allowDrop}
                  onDrop={(event) => {
                    dropInAnswer(event, index);
                  }}
                  onClick={() => {
                    setSelected(item.id);
                  }}
                >
                  <span className="pi-ex-parsons__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <code style={{ paddingInlineStart: `${item.indent * 2}ch` }}>
                    {codeOf(item.id)}
                  </code>
                  <span className="sr-only">
                    , {index + 1}/{order.length}번째 줄
                    {item.indent > 0 ? `, 들여쓰기 ${item.indent}단계` : ''}
                    {mark ? `, ${mark.message}` : ''}
                  </span>
                  {mark && (
                    <span className="pi-ex-parsons__mark" aria-hidden="true">
                      {mark.level === 'success' ? <Check size={14} /> : <X size={14} />}
                      {mark.level === 'success' ? '제자리' : '들여쓰기'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {order.length === 0 && (
            <p className="pi-ex-parsons__empty">코드 조각을 눌러 여기에 놓으세요.</p>
          )}
          <p id={keysId} className="sr-only">
            위아래 화살표로 줄을 고르고, Alt와 위아래 화살표로 옮겨요. Alt와 좌우 화살표로
            들여쓰기를 바꾸고, Delete로 코드 조각에 돌려놓아요.
          </p>
          {!disabled && (
            <div className="pi-ex-parsons__tools" role="group" aria-label="고른 줄 편집">
              <ToolButton
                label="위로 옮기기"
                icon={<ArrowUp size={14} aria-hidden="true" />}
                disabled={current <= 0}
                onClick={() => {
                  move(current, -1);
                }}
              />
              <ToolButton
                label="아래로 옮기기"
                icon={<ArrowDown size={14} aria-hidden="true" />}
                disabled={current < 0 || current >= order.length - 1}
                onClick={() => {
                  move(current, 1);
                }}
              />
              <ToolButton
                label="내어쓰기"
                icon={<IndentDecrease size={14} aria-hidden="true" />}
                disabled={!currentItem || currentItem.indent === 0}
                onClick={() => {
                  indent(current, -1);
                }}
              />
              <ToolButton
                label="들여쓰기"
                icon={<IndentIncrease size={14} aria-hidden="true" />}
                disabled={!currentItem || currentItem.indent >= PARSONS_UI_MAX_INDENT}
                onClick={() => {
                  indent(current, 1);
                }}
              />
              <ToolButton
                label="조각으로 돌려놓기"
                icon={<Undo2 size={14} aria-hidden="true" />}
                disabled={current < 0}
                onClick={() => {
                  remove(current);
                }}
              />
            </div>
          )}
        </section>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {spec.checks && spec.checks.length > 0 && (
        <CheckList
          checks={spec.checks}
          results={checkResults ?? null}
          {...(spec.entry === undefined ? {} : { entry: spec.entry })}
        />
      )}
    </div>
  );
}

function ToolButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" icon={icon} disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}
