import type {
  ContextSource,
  ExerciseAccess,
  ExerciseContext,
  MisconceptionContext,
  SessionSummaryContext,
  TutorMessageContext,
} from '../context/source.ts';

/** In-memory ContextSource honoring access the same way the server must (D-010). */
export function fakeSource(
  overrides: {
    messages?: TutorMessageContext[];
    solution?: string;
    misconceptions?: MisconceptionContext[];
    summary?: SessionSummaryContext | null;
    pastSummaries?: SessionSummaryContext[];
    prerequisites?: Record<string, string[]>;
  } = {},
): ContextSource & { exerciseCalls: ExerciseAccess[] } {
  const exerciseCalls: ExerciseAccess[] = [];
  const hints = ['방향 힌트', '개념 힌트', '거의 완성 힌트'];
  return {
    exerciseCalls,
    conceptStates: (ids, opts) => {
      const state = (id: string) => ({
        id,
        title: `${id} 제목`,
        stage: 'practicing',
        mastery: 48,
        due: null,
      });
      const pre = opts?.includePrerequisites
        ? ids.flatMap((id) =>
            (overrides.prerequisites?.[id] ?? []).map((p) => ({
              ...state(p),
              stage: 'introduced',
              mastery: 20,
              prerequisiteOf: id,
            })),
          )
        : [];
      return Promise.resolve([...ids.map(state), ...pre]);
    },
    misconceptions: (ids) =>
      Promise.resolve((overrides.misconceptions ?? []).filter((m) => ids.includes(m.conceptId))),
    exercise: (id, access): Promise<ExerciseContext | null> => {
      exerciseCalls.push(access);
      if (id === 'missing') return Promise.resolve(null);
      return Promise.resolve({
        id,
        type: 'implement_function',
        difficulty: 2,
        prompt: '짝수만 더하는 함수 sumEven을 완성하세요.',
        code: 'function sumEven(numbers) {}',
        publicSpec: '{"entry":"sumEven"}',
        conceptIds: ['js.loops.for'],
        openedHints: hints.slice(0, access.hintLevel).map((text, i) => ({ level: i + 1, text })),
        solution: access.solutionViewed
          ? { explanation: '해설', answer: overrides.solution ?? 'let total = 0;' }
          : null,
        access,
        origin: 'authored',
      });
    },
    attempts: () =>
      Promise.resolve([
        {
          id: 'a1',
          outcome: 'incorrect',
          score: 0.5,
          confidence: 'sure',
          hintLevelMax: 0,
          answerSummary: 'total += n',
          feedback: ['basic 실패'],
          submittedAt: 1,
        },
      ]),
    lesson: (id, opts) =>
      Promise.resolve({
        id,
        title: '반복문',
        summary: 'for 문',
        objectives: ['for 문을 쓴다'],
        sectionText: opts.sectionId ? '섹션 본문' : null,
        sectionId: opts.sectionId,
        concepts: [{ id: 'js.loops.for', title: 'for 문', summary: '반복' }],
      }),
    threadMessages: (_id, opts) =>
      Promise.resolve(
        (overrides.messages ?? []).filter(
          (m) =>
            !opts.excludeMessageIds.includes(m.id) &&
            (opts.after === undefined || m.createdAt > opts.after),
        ),
      ),
    threadSummary: () => Promise.resolve(overrides.summary ?? null),
    pastSummaries: () => Promise.resolve(overrides.pastSummaries ?? []),
  };
}
