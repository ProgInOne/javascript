import { describe, expect, it } from 'vitest';
import type { AttemptDetailContext, CatalogMisconceptionContext } from '../context/source.ts';
import type { OutputGuard } from '../output/validate.ts';
import { MockProvider } from '../provider/mock/mock-provider.ts';
import { TaskRunner } from '../runner.ts';
import { fakeSource } from '../test/fake-source.ts';
import { explainMistake, EXPLAIN_MISTAKE_JSON_SCHEMA } from './evaluator-explain-mistake.ts';
import { misconceptionPropose, verifyProposals } from './misconception-propose.ts';

// evaluator.explainMistake and misconception.propose: prompts built from grading facts, answer
// gating (D-010), output checks, and the app's acceptance rules for proposals (FR-AI-09).

const setup = () => {
  const provider = new MockProvider({ deltaDelayMs: 0 });
  return {
    provider,
    runner: new TaskRunner({ provider, now: () => 1_000, sleep: () => Promise.resolve() }),
  };
};

const attempt = (over: Partial<AttemptDetailContext> = {}): AttemptDetailContext => ({
  id: 'A1',
  outcome: 'incorrect',
  score: 0,
  confidence: 'sure',
  hintLevelMax: 0,
  answerSummary: '{"choice":"a"}',
  feedback: ['오답입니다.'],
  submittedAt: 10,
  exerciseId: 'js.ex.sum-even',
  exerciseType: 'mcq_single',
  exercisePrompt: 'console.log(1 + 1)은 무엇을 하나요?',
  conceptIds: ['js.loops.for'],
  correct: false,
  misconceptionIds: ['js.mc.log-is-return'],
  failedChecks: [{ id: 'basic', description: '합계', expected: '6', actual: 'NaN' }],
  practiceSetItemId: null,
  ...over,
});

const catalog: CatalogMisconceptionContext[] = [
  {
    id: 'js.mc.other',
    conceptId: 'js.loops.for',
    title: '다른 오개념',
    description: '다른 설명',
    correction: '다른 바로잡기',
  },
  {
    id: 'js.mc.log-is-return',
    conceptId: 'js.loops.for',
    title: 'console.log를 반환으로 생각함',
    description: '출력하면 값이 돌아온다고 생각합니다.',
    correction: 'console.log는 값을 돌려주지 않습니다.',
  },
];

const output = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: '출력과 반환을 같은 것으로 보았어요.',
    explanationMarkdown: '`console.log`는 값을 화면에 보여 줄 뿐이에요.',
    mistakeKind: 'concept',
    relatedConceptIds: ['js.loops.for'],
    misconceptionCandidate: { catalogId: 'js.mc.log-is-return', description: '출력=반환' },
    nextStep: 'retry',
    ...over,
  });

const input = {
  attemptId: 'A1',
  exerciseId: 'js.ex.sum-even',
  access: { hintLevel: 0 as const, solutionViewed: false },
};

describe('evaluator.explainMistake', () => {
  it('explains from the grading facts, observed misconceptions first, without the answer', async () => {
    const { provider, runner } = setup();
    provider.enqueue({ text: output() });
    const source = fakeSource({ attemptDetails: [attempt()], catalog });
    const result = await runner.run(explainMistake, input, { source });
    expect(result.status).toBe('ok');
    expect(result.output?.misconceptionCandidate?.catalogId).toBe('js.mc.log-is-return');
    const req = provider.requests[0];
    expect(req).toMatchObject({ effort: 'medium', thread: { kind: 'ephemeral' } });
    expect(req?.outputSchema).toBe(EXPLAIN_MISTAKE_JSON_SCHEMA);
    const text = req?.input ?? '';
    expect(text).toContain('<grading_result attempt="A1" outcome="incorrect"');
    expect(text).toContain('기대: 6');
    expect(text).toContain('실제: NaN');
    expect(text.indexOf('js.mc.log-is-return')).toBeLessThan(text.indexOf('js.mc.other'));
    expect(text).toContain('바로잡기: console.log는 값을 돌려주지 않습니다.');
    expect(text).not.toContain('다른 바로잡기');
    expect(text).toContain('state="solving"');
    expect(text).not.toContain('<solution>');
    expect(source.exerciseCalls.every((a) => !a.solutionViewed)).toBe(true);
    expect(result.record).toMatchObject({
      taskName: 'evaluator.explainMistake',
      taskVersion: 1,
      effort: 'medium',
      status: 'ok',
    });
  });

  it('withholds an explanation that keeps leaking the answer or showing long code', async () => {
    const { provider, runner } = setup();
    const guard: OutputGuard = {
      holdback: 10,
      findViolations: (t) => (t.includes('ANSWER') ? ['fp:0'] : []),
    };
    const code = '```js\n' + Array.from({ length: 9 }, (_, i) => `line${i};`).join('\n') + '\n```';
    provider.enqueue(
      { text: output({ explanationMarkdown: '정답은 ANSWER예요.' }) },
      { text: output({ explanationMarkdown: code }) },
    );
    const result = await runner.run(explainMistake, input, {
      source: fakeSource({ attemptDetails: [attempt()], catalog }),
      guard,
    });
    expect(result.status).toBe('withheld');
    expect(result.record.validationIssues.map((i) => i.rule)).toEqual([
      'answer_leak',
      'code_lines',
    ]);
    expect(provider.requests[1]?.developerInstructions).toContain(
      '[중요] 직전 답변이 학습 정책을 어겼다',
    );
  });
});

describe('misconception.propose', () => {
  it('cites the given attempts and the concept catalog', async () => {
    const { provider, runner } = setup();
    provider.enqueue({ text: '{"proposals":[]}' });
    const result = await runner.run(
      misconceptionPropose,
      { conceptId: 'js.loops.for', attemptIds: ['A2', 'A1'], signals: ['출력을 반환으로 말함'] },
      {
        source: fakeSource({
          attemptDetails: [attempt(), attempt({ id: 'A2', exerciseId: 'js.ex.other' })],
          catalog,
        }),
      },
    );
    expect(result.output).toEqual({ proposals: [] });
    const req = provider.requests[0];
    expect(req).toMatchObject({ taskName: 'misconception.propose', effort: 'low' });
    expect(req?.input).toMatch(/<attempt id="A2"[\s\S]*<attempt id="A1"/);
    expect(req?.input).toContain('<signal>');
    expect(req?.input).toContain('<misconception id="js.mc.other"');
  });

  it('keeps only verifiable, confident proposals for the concept', () => {
    const proposal = {
      catalogId: null as string | null,
      newDescription: null as string | null,
      conceptId: 'js.loops.for',
      evidenceAttemptIds: ['A1'],
      confidence: 'medium' as const,
      reasoning: '',
    };
    const { proposals, issues } = verifyProposals(
      {
        proposals: [
          { ...proposal, catalogId: 'js.mc.log-is-return', evidenceAttemptIds: ['A1', 'X'] },
          { ...proposal, catalogId: 'js.mc.log-is-return' },
          { ...proposal, catalogId: 'js.mc.unknown' },
          { ...proposal, catalogId: 'js.mc.elsewhere' },
          { ...proposal, newDescription: '변수 선언 없이 += 를 써도 된다고 생각함' },
          { ...proposal, newDescription: '추측', confidence: 'low' },
          { ...proposal, newDescription: '근거 없음', evidenceAttemptIds: ['RIGHT'] },
          { ...proposal, newDescription: '   ' },
        ],
      },
      {
        conceptId: 'js.loops.for',
        wrongAttemptIds: new Set(['A1']),
        catalog: new Map([
          ['js.mc.log-is-return', 'js.loops.for'],
          ['js.mc.elsewhere', 'js.other'],
        ]),
      },
    );
    expect(proposals).toEqual([
      {
        catalogId: 'js.mc.log-is-return',
        description: null,
        conceptId: 'js.loops.for',
        evidenceAttemptIds: ['A1'],
        confidence: 'medium',
      },
      {
        catalogId: null,
        description: '변수 선언 없이 += 를 써도 된다고 생각함',
        conceptId: 'js.loops.for',
        evidenceAttemptIds: ['A1'],
        confidence: 'medium',
      },
    ]);
    expect(issues.map((i) => i.rule)).toEqual([
      'catalog',
      'concept',
      'low_confidence',
      'evidence',
      'description',
    ]);
  });
});
