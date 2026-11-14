import { Progress as ProgressPrimitive } from 'radix-ui';
import { cx } from './cx.ts';

interface ProgressBase {
  /** 0 to `max`. */
  value: number;
  max?: number | undefined;
  /** Accessible name, e.g. "단원 진도". */
  label: string;
  className?: string | undefined;
}

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
const percent = (value: number, max: number) => Math.round((clamp(value, max) / max) * 100);

export interface ProgressBarProps extends ProgressBase {
  /** Track height: 4 / 6 / 8px. */
  size?: 4 | 6 | 8 | undefined;
}

/** Linear progress (Radix, `role="progressbar"` with value text in percent). */
export function ProgressBar({ value, max = 100, label, size = 6, className }: ProgressBarProps) {
  const v = clamp(value, max);
  return (
    <ProgressPrimitive.Root
      className={cx('pi-progress', className)}
      value={v}
      max={max}
      aria-label={label}
      getValueLabel={(current, total) => `${percent(current, total)}%`}
      style={{ height: size }}
    >
      <ProgressPrimitive.Indicator
        className="pi-progress__fill"
        style={{ transform: `translateX(-${100 - percent(v, max)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export interface ProgressRingProps extends ProgressBase {
  /** Diameter: 24 / 40 / 64 / 120px. The percentage shows from 40px up. */
  size?: 24 | 40 | 64 | 120 | undefined;
}

/** Circular progress with the percentage in the center. */
export function ProgressRing({ value, max = 100, label, size = 40, className }: ProgressRingProps) {
  const pct = percent(value, max);
  const stroke = size <= 24 ? 3 : size >= 120 ? 8 : 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div
      className={cx('pi-ring', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamp(value, max)}
      aria-valuetext={`${pct}%`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="pi-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="pi-ring__fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
        />
      </svg>
      {size >= 40 && (
        <span className="pi-ring__label tnum" aria-hidden="true" data-size={size}>
          {pct}%
        </span>
      )}
    </div>
  );
}
