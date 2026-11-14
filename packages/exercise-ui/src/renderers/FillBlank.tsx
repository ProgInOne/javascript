import type {
  CheckResult,
  FeedbackItem,
  FillBlankAnswer,
  FillBlankPublicSpec,
} from '@proginone/exercise-kit';
import { Check, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { RendererBaseProps } from '../types.ts';
import { CheckList } from '../widgets/CheckList.tsx';

export interface FillBlankProps extends RendererBaseProps<FillBlankPublicSpec, FillBlankAnswer> {
  /**
   * Grader feedback (`GradeResult.feedback`). Items whose `target` is a blank ID mark that blank as
   * correct (`success`) or wrong (`error`) with an icon and text.
   */
  feedback?: readonly FeedbackItem[];
  /** Code mode: per-check results to show in the test list. */
  checkResults?: readonly CheckResult[] | null;
}

type Segment = { kind: 'text'; text: string } | { kind: 'blank'; id: string };

const PLACEHOLDER = /\{\{blank:([a-z0-9][a-z0-9_-]{0,47})\}\}/g;

/** Splits a template into text and `{{blank:id}}` segments. */
export function parseBlankTemplate(template: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match.index > last)
      segments.push({ kind: 'text', text: template.slice(last, match.index) });
    segments.push({ kind: 'blank', id: match[1] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < template.length) segments.push({ kind: 'text', text: template.slice(last) });
  return segments;
}

/**
 * `fill_blank` (docs/design/content-and-exercises.md#fill_blank-빈칸-채우기): inline inputs inside the
 * code or sentence, in reading order, so `Tab` moves to the next blank. Code mode also lists the
 * checks the filled-in code must pass.
 */
export function FillBlank({
  spec,
  value,
  onChange,
  disabled = false,
  labelledBy,
  feedback = [],
  checkResults,
}: FillBlankProps) {
  const baseId = useId();
  const segments = parseBlankTemplate(spec.template);
  const widths = new Map(spec.blanks.map((b) => [b.id, b.width]));
  const order = segments.flatMap((s) => (s.kind === 'blank' ? [s.id] : []));
  const status = new Map<string, FeedbackItem>();
  for (const item of feedback) {
    if (item.target !== undefined && (item.level === 'success' || item.level === 'error'))
      status.set(item.target, item);
  }
  const asCode = spec.mode === 'code' || spec.template.includes('\n');

  const renderBlank = (id: string): ReactNode => {
    const index = order.indexOf(id) + 1;
    const item = status.get(id);
    const wrong = item?.level === 'error';
    const messageId = `${baseId}-${id}-msg`;
    // The authored width is a minimum: the input grows with longer answers (capped) so text stays visible.
    const width = Math.min(40, Math.max(widths.get(id) ?? 4, (value.blanks[id] ?? '').length + 1));
    return (
      <span key={id} className="pi-ex-blank" data-state={item?.level}>
        <input
          type="text"
          className="pi-ex-blank__input"
          aria-label={`빈칸 ${index} / ${order.length}`}
          aria-invalid={wrong || undefined}
          aria-describedby={item ? messageId : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          style={{ width: `calc(${width}ch + 1.25rem)` }}
          value={value.blanks[id] ?? ''}
          onChange={(event) => {
            onChange({ blanks: { ...value.blanks, [id]: event.target.value } });
          }}
        />
        {item && (
          <span id={messageId} className="pi-ex-blank__mark">
            {wrong ? <X size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            <span className="sr-only">{wrong ? item.message : '맞았어요'}</span>
          </span>
        )}
      </span>
    );
  };

  const body = segments.map((segment, i) =>
    segment.kind === 'text' ? <span key={`t${i}`}>{segment.text}</span> : renderBlank(segment.id),
  );

  return (
    <div
      className="pi-ex-fill-blank"
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : '빈칸 채우기'}
    >
      {asCode ? (
        <pre className="pi-ex-code pi-ex-fill-blank__code">
          <code>{body}</code>
        </pre>
      ) : (
        <p className="pi-ex-fill-blank__text">{body}</p>
      )}
      {spec.mode === 'code' && spec.checks && spec.checks.length > 0 && (
        <CheckList
          checks={spec.checks}
          results={checkResults ?? null}
          {...(spec.entry === undefined ? {} : { entry: spec.entry })}
        />
      )}
    </div>
  );
}
