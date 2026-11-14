import type { TutorCodeFiles, TutorRunSummary } from '@proginone/shared';
import { tailLines } from './budget.ts';
import type { LoadedSection } from './builder.ts';
import { clip, data, tag } from './sections.ts';
import type {
  AttemptContext,
  ConceptStateContext,
  ContextSource,
  ExerciseAccess,
  ExerciseContext,
  LessonContext,
  SessionSummaryContext,
  TutorMessageContext,
} from './source.ts';
import { renderSummaryText } from './memory-sections.ts';

// Section loaders shared by the tutor tasks. Each returns variants from fullest to most compact
// (docs/design/ai-system.md#컨텍스트-조립-우선순위 truncation rules).

const section = (kind: string, ref: string | null, variants: string[]): LoadedSection => ({
  kind,
  ref,
  variants: [...new Set(variants)],
});

export async function conceptIdsFor(
  src: ContextSource,
  ids: { exerciseId?: string | undefined; lessonId?: string | undefined },
  access: ExerciseAccess | undefined,
): Promise<string[]> {
  const out: string[] = [];
  if (ids.exerciseId && access) {
    const exercise = await src.exercise(ids.exerciseId, access);
    out.push(...(exercise?.conceptIds ?? []));
  }
  if (ids.lessonId) {
    const lesson = await src.lesson(ids.lessonId, { sectionId: null });
    out.push(...(lesson?.concepts.map((c) => c.id) ?? []));
  }
  return [...new Set(out)];
}

function renderConcept(c: ConceptStateContext): string {
  if (c.prerequisiteOf !== undefined) {
    return tag(
      'prerequisite',
      { id: c.id, of: c.prerequisiteOf, stage: c.stage, mastery: Math.round(c.mastery) },
      data(c.title),
    );
  }
  return tag(
    'concept',
    { id: c.id, stage: c.stage, mastery: Math.round(c.mastery), due: c.due },
    data(c.title),
  );
}

/**
 * `<learner_state>`: the concepts in focus, then their direct prerequisites (docs: 현재 학습 상태,
 * 우선순위 10). Cut by dropping prerequisites, then all but three concepts.
 */
export function learnerStateSection(states: ConceptStateContext[]): LoadedSection | null {
  if (states.length === 0) return null;
  const targets = states.filter((s) => s.prerequisiteOf === undefined);
  const render = (list: ConceptStateContext[]) =>
    tag('learner_state', {}, list.map(renderConcept).join('\n'));
  return section('learner_state', null, [
    render(states),
    render(targets.length > 0 ? targets : states),
    render((targets.length > 0 ? targets : states).slice(0, 3)),
  ]);
}

export function exerciseSection(ex: ExerciseContext): LoadedSection {
  const attrs = {
    id: ex.id,
    type: ex.type,
    difficulty: ex.difficulty,
    origin: ex.origin,
    state: ex.access.solutionViewed ? 'solution_viewed' : 'solving',
    hint_level: ex.access.hintLevel,
  };
  const hints =
    ex.openedHints.length === 0
      ? null
      : tag(
          'opened_hints',
          {},
          ex.openedHints.map((h) => tag('hint', { level: h.level }, data(h.text))).join('\n'),
        );
  const solution = ex.solution
    ? [
        tag('solution', {}, data(ex.solution.answer)),
        tag('explanation', {}, data(ex.solution.explanation)),
      ].join('\n')
    : null;
  const prompt = tag('prompt', {}, data(ex.prompt));
  const code = ex.code ? tag('code', {}, data(ex.code)) : null;
  const spec = ex.publicSpec ? tag('public_spec', {}, data(clip(ex.publicSpec, 4_000))) : null;
  const build = (parts: (string | null)[]) =>
    tag('exercise', attrs, parts.filter((p): p is string => p !== null).join('\n'));
  return section('exercise', ex.id, [
    build([prompt, code, spec, hints, solution]),
    build([prompt, code, hints, solution]),
    build([prompt, hints, solution]),
    build([prompt]),
  ]);
}

export function learnerCodeSection(files: TutorCodeFiles | undefined): LoadedSection | null {
  const entries = Object.entries(files ?? {});
  if (entries.length === 0) return null;
  const render = (maxLines: number) =>
    entries
      .map(([path, content]) => {
        const lines = content.replace(/\r\n?/g, '\n').split('\n');
        const kept = lines.length > maxLines ? [...lines.slice(0, maxLines), '…(생략)'] : lines;
        return tag('learner_code', { file: path }, data(kept.join('\n')));
      })
      .join('\n');
  return section('learner_code', null, [render(400), render(120), render(40)]);
}

export function runResultSection(run: TutorRunSummary | undefined): LoadedSection | null {
  if (!run) return null;
  const render = (consoleLines: number, withChecks: boolean) => {
    const parts: string[] = [];
    if (run.console.length > 0) {
      parts.push(tag('console', {}, data(tailLines(run.console, consoleLines).join('\n'))));
    }
    if (run.error) parts.push(tag('error', {}, data(run.error)));
    if (withChecks) {
      for (const c of run.failedChecks)
        parts.push(tag('failed_check', { id: c.id }, data(c.description)));
    }
    return tag('run_result', { status: run.status }, parts.join('\n') || '(출력 없음)');
  };
  return section('run_result', null, [render(50, true), render(10, true), render(3, false)]);
}

function renderAttempt(a: AttemptContext): string {
  const body = [`답: ${a.answerSummary}`, ...a.feedback.map((f) => `피드백: ${f}`)].join('\n');
  return tag(
    'attempt',
    {
      outcome: a.outcome,
      score: Math.round(a.score * 100) / 100,
      confidence: a.confidence,
      hint_level: a.hintLevelMax,
    },
    data(body),
  );
}

export function attemptHistorySection(list: AttemptContext[]): LoadedSection | null {
  if (list.length === 0) return null;
  const render = (n: number) =>
    tag('attempt_history', {}, list.slice(0, n).map(renderAttempt).join('\n'));
  return section('attempt_history', null, [render(5), render(3), render(1)]);
}

export function lessonSection(lesson: LessonContext): LoadedSection {
  const head = [
    `요약: ${lesson.summary}`,
    lesson.objectives.length > 0 ? `학습 목표: ${lesson.objectives.join(' / ')}` : '',
    ...lesson.concepts.map((c) => `개념 ${c.id} (${c.title}): ${c.summary}`),
  ]
    .filter(Boolean)
    .join('\n');
  const render = (sectionChars: number | null) => {
    const parts = [data(head)];
    if (lesson.sectionText && sectionChars !== null) {
      parts.push(
        tag(
          'lesson_section',
          { id: lesson.sectionId },
          data(clip(lesson.sectionText, sectionChars)),
        ),
      );
    }
    return tag('lesson', { id: lesson.id, title: lesson.title }, parts.join('\n'));
  };
  return section('lesson', lesson.id, [render(6_000), render(1_500), render(null)]);
}

/**
 * `<conversation_so_far>` for a rebuilt provider thread (docs: 재구성): the thread's rolling
 * summary, then the messages after it. Cut by keeping fewer recent messages; the summary stays.
 */
export function conversationSection(
  messages: TutorMessageContext[],
  summary: SessionSummaryContext | null = null,
): LoadedSection | null {
  if (messages.length === 0 && !summary) return null;
  const summaryBlock = summary
    ? tag(
        'thread_summary',
        { covered_until: new Date(summary.coveredUntil).toISOString() },
        data(renderSummaryText(summary)),
      )
    : null;
  const render = (n: number) =>
    tag(
      'conversation_so_far',
      {},
      [
        summaryBlock,
        ...messages
          .slice(messages.length - Math.min(n, messages.length))
          .map((m) => tag('message', { role: m.role }, data(clip(m.content, 2_000)))),
      ]
        .filter((p): p is string => p !== null)
        .join('\n'),
    );
  return section('conversation_so_far', null, [render(12), render(6), render(2), render(0)]);
}
