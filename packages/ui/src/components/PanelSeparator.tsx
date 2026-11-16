import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from './cx.ts';

export interface PanelSeparatorProps {
  /** Accessible name, e.g. "문제 패널 폭". */
  label: string;
  /**
   * `vertical`: a line between two columns that changes a width (←/→).
   * `horizontal`: a line between two rows that changes a height (↑/↓).
   */
  orientation: 'vertical' | 'horizontal';
  /** Current size of the controlled panel, in `unit`s. */
  value: number;
  min: number;
  max: number;
  /** Called with the next size, already clamped and rounded. */
  onChange: (value: number) => void;
  /** Double click restores the default size. */
  onReset?: () => void;
  /**
   * Keyboard step in `unit`s (ui-ux.md 패널 리사이즈: 10px per arrow key). Callers whose value is
   * not in pixels convert 10px to their unit.
   */
  step?: number;
  /** Pixels per `unit` for pointer dragging (1 when the value is in pixels). */
  pixelsPerUnit?: number;
  /**
   * The controlled panel sits after the separator (a right drawer, a bottom panel): moving the
   * separator right or down makes it smaller.
   */
  panelAfter?: boolean;
  /** `aria-valuetext`, e.g. "40%". Defaults to the number. */
  valueText?: string;
  /** Id of the controlled panel (`aria-controls`). */
  controls?: string;
  className?: string;
}

/**
 * Resize handle for a pair of panels (WAI-ARIA window splitter pattern): focusable
 * `role="separator"` with its value, arrow keys move it by `step`, Home/End jump to the minimum and
 * maximum, double click resets, and pointer drag works with mouse, pen and touch. The hit area is
 * 8px with a 2px line (ui-ux.md 반응형과 패널 규칙); dragging is never the only way (WCAG 2.5.7).
 */
export function PanelSeparator({
  label,
  orientation,
  value,
  min,
  max,
  onChange,
  onReset,
  step = 10,
  pixelsPerUnit = 1,
  panelAfter = false,
  valueText,
  controls,
  className,
}: PanelSeparatorProps) {
  const drag = useRef<{ start: number; value: number } | null>(null);
  const vertical = orientation === 'vertical';
  // Pixel values stay whole; other units (a percentage) keep one decimal.
  const decimals = pixelsPerUnit === 1 && Number.isInteger(step) ? 0 : 1;
  const clamp = (v: number) => {
    const factor = 10 ** decimals;
    return Math.min(max, Math.max(min, Math.round(v * factor) / factor));
  };
  // Grow keys: toward the side that makes the controlled panel larger.
  const growKey = vertical
    ? panelAfter
      ? 'ArrowLeft'
      : 'ArrowRight'
    : panelAfter
      ? 'ArrowUp'
      : 'ArrowDown';
  const shrinkKey = vertical
    ? panelAfter
      ? 'ArrowRight'
      : 'ArrowLeft'
    : panelAfter
      ? 'ArrowDown'
      : 'ArrowUp';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const next =
      e.key === growKey
        ? value + step
        : e.key === shrinkKey
          ? value - step
          : e.key === 'Home'
            ? min
            : e.key === 'End'
              ? max
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onChange(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      {...(valueText === undefined ? {} : { 'aria-valuetext': valueText })}
      {...(controls === undefined ? {} : { 'aria-controls': controls })}
      tabIndex={0}
      className={cx('pi-separator', `pi-separator--${orientation}`, className)}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // Keeps the drag when the pointer leaves the 8px handle (absent in some test DOMs).
        if ('setPointerCapture' in e.currentTarget) e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        drag.current = { start: vertical ? e.clientX : e.clientY, value };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const delta = ((vertical ? e.clientX : e.clientY) - drag.current.start) / pixelsPerUnit;
        onChange(clamp(drag.current.value + (panelAfter ? -delta : delta)));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}
