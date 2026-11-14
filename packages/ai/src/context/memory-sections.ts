import type { LoadedSection } from './builder.ts';
import { clip, data, tag } from './sections.ts';
import type { MisconceptionContext, SessionSummaryContext } from './source.ts';

// Long-term memory sections (docs/design/ai-system.md#장기-학습-기억): active misconceptions and
// conversation summaries. Summaries and AI-proposed misconceptions were written by a model
// earlier, so they are data like any other block.

const section = (kind: string, ref: string | null, variants: string[]): LoadedSection => ({
  kind,
  ref,
  variants: [...new Set(variants)],
});

/** Plain text of a summary for a prompt block. */
export function renderSummaryText(s: SessionSummaryContext): string {
  const lines = [clip(s.shortSummary, 500)];
  if (s.struggles.length > 0) {
    lines.push(
      `어려워한 점: ${s.struggles.map((x) => `${x.conceptId} — ${clip(x.note, 120)}`).join(' / ')}`,
    );
  }
  if (s.misconceptionSignals.length > 0) {
    lines.push(`오개념 신호: ${s.misconceptionSignals.map((m) => clip(m, 120)).join(' / ')}`);
  }
  if (s.openQuestions.length > 0) {
    lines.push(`남은 질문: ${s.openQuestions.map((q) => clip(q, 120)).join(' / ')}`);
  }
  return lines.join('\n');
}

/**
 * `<active_misconceptions>` (우선순위 8): confirmed first, at most three (docs: 절단 방식).
 * The order of `list` is kept within a status.
 */
export function misconceptionsSection(list: MisconceptionContext[]): LoadedSection | null {
  if (list.length === 0) return null;
  const ordered = [
    ...list.filter((m) => m.status === 'confirmed'),
    ...list.filter((m) => m.status !== 'confirmed'),
  ];
  const render = (n: number, withDescription: boolean) =>
    tag(
      'active_misconceptions',
      {},
      ordered
        .slice(0, n)
        .map((m) =>
          tag(
            'misconception',
            {
              id: m.id,
              concept: m.conceptId,
              status: m.status,
              origin: m.origin,
              evidence_count: m.evidenceCount,
            },
            data(
              withDescription && m.description !== m.title
                ? `${m.title}: ${clip(m.description, 300)}`
                : m.title,
            ),
          ),
        )
        .join('\n'),
    );
  return section('active_misconceptions', null, [
    render(3, true),
    render(3, false),
    render(1, false),
  ]);
}

/** `<past_summaries>` (우선순위 4): related summaries of other conversations, 3 → 1. */
export function pastSummariesSection(list: SessionSummaryContext[]): LoadedSection | null {
  if (list.length === 0) return null;
  const render = (n: number) =>
    tag(
      'past_summaries',
      {},
      list
        .slice(0, n)
        .map((s) =>
          tag(
            'summary',
            {
              date: new Date(s.createdAt).toISOString().slice(0, 10),
              concepts: s.conceptIds.slice(0, 5).join(' '),
            },
            data(renderSummaryText(s)),
          ),
        )
        .join('\n'),
    );
  return section('past_summaries', null, [render(3), render(2), render(1)]);
}
