import type { LoadedSection } from './builder.ts';
import { clip, data, tag } from './sections.ts';
import type { AttemptDetailContext, CatalogMisconceptionContext } from './source.ts';

// Sections of the evaluator and analyst tasks (evaluator.explainMistake, misconception.propose).
// Grading results are facts decided by the app; the learner's answer inside them is data.

const section = (kind: string, ref: string | null, variants: string[]): LoadedSection => ({
  kind,
  ref,
  variants: [...new Set(variants)],
});

function failedChecks(a: AttemptDetailContext, withValues: boolean): string[] {
  return a.failedChecks.map((c) =>
    tag(
      'check',
      { id: c.id, result: 'failed' },
      data(
        [
          clip(c.description, 300),
          withValues && c.expected !== null ? `기대: ${clip(c.expected, 300)}` : null,
          withValues && c.actual !== null ? `실제: ${clip(c.actual, 300)}` : null,
        ]
          .filter((l): l is string => l !== null)
          .join('\n'),
      ),
    ),
  );
}

/**
 * `<grading_result>`: the attempt being explained (docs: 채점 결과 — 실패한 체크와 기대값·실제값,
 * 시도 후이므로 해당 체크의 기대값은 공개 가능). Hidden checks never reach this section.
 */
export function gradingResultSection(a: AttemptDetailContext): LoadedSection {
  const render = (answerChars: number, withValues: boolean, feedback: number) =>
    tag(
      'grading_result',
      {
        attempt: a.id,
        outcome: a.outcome,
        score: Math.round(a.score * 100) / 100,
        confidence: a.confidence,
        hint_level: a.hintLevelMax,
      },
      [
        tag('learner_answer', {}, data(clip(a.answerSummary, answerChars))),
        ...a.feedback.slice(0, feedback).map((f) => tag('feedback', {}, data(clip(f, 300)))),
        ...failedChecks(a, withValues),
      ].join('\n'),
    );
  return section('grading_result', a.id, [
    render(2_000, true, 5),
    render(800, true, 3),
    render(300, false, 2),
  ]);
}

/**
 * `<misconception_catalog>`: misconceptions of the exercise's concepts. Those the grader matched
 * (`observed`) come first with their correction; a proposal must pick a catalog id when one fits.
 */
export function catalogSection(
  list: CatalogMisconceptionContext[],
  observed: readonly string[],
): LoadedSection | null {
  if (list.length === 0) return null;
  const ordered = [
    ...list.filter((m) => observed.includes(m.id)),
    ...list.filter((m) => !observed.includes(m.id)),
  ];
  const render = (n: number, withCorrection: boolean) =>
    tag(
      'misconception_catalog',
      {},
      ordered
        .slice(0, n)
        .map((m) => {
          const seen = observed.includes(m.id);
          const body = [
            `${m.title}: ${clip(m.description, 300)}`,
            seen && withCorrection ? `바로잡기: ${clip(m.correction, 300)}` : null,
          ]
            .filter((l): l is string => l !== null)
            .join('\n');
          return tag(
            'misconception',
            { id: m.id, concept: m.conceptId, observed: seen || null },
            data(body),
          );
        })
        .join('\n'),
    );
  return section('misconception_catalog', null, [
    render(12, true),
    render(6, true),
    render(3, false),
  ]);
}

/** `<attempts>`: the attempts a misconception proposal may cite, newest first. */
export function attemptsSection(list: AttemptDetailContext[]): LoadedSection | null {
  if (list.length === 0) return null;
  const render = (n: number, chars: number) =>
    tag(
      'attempts',
      {},
      list
        .slice(0, n)
        .map((a) =>
          tag(
            'attempt',
            {
              id: a.id,
              exercise: a.exerciseId,
              type: a.exerciseType,
              outcome: a.outcome,
              confidence: a.confidence,
            },
            [
              tag('prompt', {}, data(clip(a.exercisePrompt, chars))),
              tag('learner_answer', {}, data(clip(a.answerSummary, chars))),
              ...a.feedback.slice(0, 2).map((f) => tag('feedback', {}, data(clip(f, 200)))),
              ...failedChecks(a, true).slice(0, 3),
            ].join('\n'),
          ),
        )
        .join('\n'),
    );
  return section('attempts', null, [render(10, 400), render(6, 250), render(3, 150)]);
}

/** `<signals>`: hints from conversations (summaries, tutor replies) that something is off. */
export function signalsSection(signals: readonly string[]): LoadedSection | null {
  if (signals.length === 0) return null;
  return section('signals', null, [
    tag(
      'signals',
      {},
      signals
        .slice(0, 5)
        .map((s) => tag('signal', {}, data(clip(s, 300))))
        .join('\n'),
    ),
  ]);
}
