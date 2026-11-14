import { leakFingerprints } from '@proginone/exercise-kit';
import { attemptResponseSchema, mistakeExplanationSchema } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ANSWER_MARKERS, EX, FIXTURE_EXERCISES } from '../../test/content-fixture.ts';
import { count, MINUTE, practiceApp } from '../../test/practice-app.ts';
import { errorCode, lessonSet, submit } from '../../test/practice-flow.ts';

// evaluator.explainMistake (POST /attempts/:id/explanation) and misconception.propose: what the
// AI sees (D-010), what of its output is kept (FR-AI-09), fallbacks and ai_calls records.

type Ctx = Awaited<ReturnType<typeof practiceApp>>;

async function wrongAttempt(ctx: Ctx, exerciseId: string, body: object = {}) {
  const set = await lessonSet(ctx);
  const item = set.items.find((i) => i.exerciseId === exerciseId);
  if (!item) throw new Error(`no item for ${exerciseId}`);
  const res = await submit(ctx, item, { correct: false, body });
  expect(res.status).toBe(201);
  return attemptResponseSchema.parse(res.json).attempt.id;
}

const explanation = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: '출력과 반환을 같은 것으로 보았어요.',
    explanationMarkdown: '`console.log`는 값을 화면에 보여 줄 뿐 돌려주지 않아요.',
    mistakeKind: 'concept',
    relatedConceptIds: ['js.basics.statement', 'no.such.concept'],
    misconceptionCandidate: { catalogId: 'js.mc.log-is-return', description: '출력=반환' },
    nextStep: 'retry',
    ...over,
  });

const explain = async (ctx: Ctx, attemptId: string) => {
  const res = await ctx.call('POST', `/attempts/${attemptId}/explanation`, {});
  return { status: res.status, json: res.json };
};

const observations = (ctx: Ctx) =>
  ctx.userDb.sqlite
    .prepare(
      'SELECT misconception_id, status, source, ai_description, evidence_attempt_ids_json FROM misconception_observations ORDER BY first_seen_at',
    )
    .all() as {
    misconception_id: string;
    status: string;
    source: string;
    ai_description: string | null;
    evidence_attempt_ids_json: string;
  }[];

describe('evaluator.explainMistake · POST /attempts/:id/explanation', () => {
  it('explains a wrong attempt without the answer key and records the call', async () => {
    const ctx = await practiceApp();
    const attemptId = await wrongAttempt(ctx, EX.mcq);
    ctx.ai.provider.enqueue({ text: explanation() });
    const res = await explain(ctx, attemptId);
    expect(res.status).toBe(200);
    const out = mistakeExplanationSchema.parse(res.json);
    expect(out).toMatchObject({
      attemptId,
      source: 'ai',
      fallbackCode: null,
      mistakeKind: 'concept',
      nextStep: 'retry',
      relatedConcepts: [{ id: 'js.basics.statement' }],
      // The grader already recorded it (sure + wrong option → confirmed); AI does not change it.
      misconception: { id: 'js.mc.log-is-return', status: 'confirmed', origin: 'catalog' },
    });
    const req = ctx.ai.provider.requests.at(-1);
    expect(req).toMatchObject({ taskName: 'evaluator.explainMistake', effort: 'medium' });
    const input = req?.input ?? '';
    expect(input).toContain(`<grading_result attempt="${attemptId}" outcome="incorrect"`);
    expect(input).toContain('state="solving"');
    expect(input).toContain(
      '<misconception id="js.mc.log-is-return" concept="js.basics.statement" observed="true">',
    );
    // The chosen option's rationale is the feedback the learner already saw after grading;
    // other answer keys, hidden checks and the correct option never reach the prompt.
    expect(input).toMatch(/<feedback>\nRATIONALE-MARK\n<\/feedback>/);
    for (const marker of ANSWER_MARKERS.filter((m) => m !== 'RATIONALE-MARK')) {
      expect(input).not.toContain(marker);
    }
    expect(input).not.toContain('"correct"');

    const call = ctx.userDb.sqlite
      .prepare(
        "SELECT status, subject_type, subject_id, effort, task_version, model, latency_total_ms FROM ai_calls WHERE task_name = 'evaluator.explainMistake'",
      )
      .get() as Record<string, unknown>;
    expect(call).toMatchObject({
      status: 'ok',
      subject_type: 'attempt',
      subject_id: attemptId,
      effort: 'medium',
      task_version: 1,
      model: 'mock-tutor',
    });
    expect(typeof call['latency_total_ms']).toBe('number');

    // The same attempt is answered from memory (no second AI call).
    const before = ctx.ai.provider.requests.length;
    expect((await explain(ctx, attemptId)).json).toEqual(res.json);
    expect(ctx.ai.provider.requests.length).toBe(before);
  });

  it('records an unclassified AI candidate only as suspected, with the attempt as evidence', async () => {
    const ctx = await practiceApp();
    const attemptId = await wrongAttempt(ctx, EX.fillText);
    ctx.ai.provider.enqueue({
      text: explanation({
        misconceptionCandidate: {
          catalogId: null,
          description: '세미콜론과 콜론을 같은 기호로 생각함',
        },
      }),
    });
    const out = mistakeExplanationSchema.parse((await explain(ctx, attemptId)).json);
    expect(out.misconception).toMatchObject({ status: 'suspected', origin: 'ai' });
    expect(out.misconception?.id).toMatch(/^ai\./);
    const row = observations(ctx).find((o) => o.misconception_id === out.misconception?.id);
    expect(row).toMatchObject({
      status: 'suspected',
      source: 'ai',
      ai_description: '세미콜론과 콜론을 같은 기호로 생각함',
    });
    expect(JSON.parse(row?.evidence_attempt_ids_json ?? '[]')).toEqual([attemptId]);
  });

  it('falls back to the authored misconception text when AI is unavailable or leaks', async () => {
    const ctx = await practiceApp();
    const attemptId = await wrongAttempt(ctx, EX.mcq);
    ctx.ai.provider.setStatus({ state: 'logged_out' });
    const offline = mistakeExplanationSchema.parse((await explain(ctx, attemptId)).json);
    expect(offline).toMatchObject({
      source: 'authored',
      fallbackCode: 'AI_NOT_CONNECTED',
      summary: 'console.log를 반환으로 생각함',
      misconception: null,
    });
    expect(offline.explanationMarkdown).toContain('출력하면 값이 돌아온다고 생각합니다.');
    expect(count(ctx, 'ai_calls')).toBe(0);

    ctx.ai.provider.setStatus({ state: 'ready', planType: 'mock' });
    const ex = FIXTURE_EXERCISES.find((e) => e.id === EX.mcq);
    if (!ex) throw new Error('no mcq');
    const leak = leakFingerprints(ex.type, ex.spec).find((fp) => fp.length > 5) ?? '';
    expect(leak).not.toBe('');
    ctx.ai.provider.enqueue(
      { text: explanation({ explanationMarkdown: `정답은 ${leak} 이에요.` }) },
      { text: explanation({ explanationMarkdown: `다시 말하면 ${leak} 이에요.` }) },
    );
    const leaked = mistakeExplanationSchema.parse((await explain(ctx, attemptId)).json);
    expect(leaked).toMatchObject({ source: 'authored', fallbackCode: 'AI_BAD_OUTPUT' });
    const call = ctx.userDb.sqlite
      .prepare(
        "SELECT status, retries, validation_issues_json FROM ai_calls WHERE task_name = 'evaluator.explainMistake'",
      )
      .get() as { status: string; retries: number; validation_issues_json: string };
    expect(call).toMatchObject({ status: 'fallback', retries: 1 });
    expect(call.validation_issues_json).toContain('answer_leak');
  });

  it('refuses correct and unknown attempts', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const item = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!item) throw new Error('no item');
    const correct = attemptResponseSchema.parse((await submit(ctx, item)).json).attempt.id;
    const res = await explain(ctx, correct);
    expect(res.status).toBe(409);
    expect(errorCode(res.json)).toBe('ATTEMPT_CORRECT');
    expect((await explain(ctx, '01JD3Z8Q6V2K9M4T7R1X5W0ZZZ')).status).toBe(404);
  });
});

describe('misconception.propose', () => {
  it('records verified proposals as suspected and never touches an active observation', async () => {
    const ctx = await practiceApp();
    const first = await wrongAttempt(ctx, EX.fillText);
    ctx.clock.now += MINUTE;
    const second = await wrongAttempt(ctx, EX.mcq, { confidence: 'unsure' });
    const evaluator = ctx.ai.evaluator;
    expect(evaluator.dueProposalConcepts()).toEqual(['js.basics.statement']);
    const before = observations(ctx).find((o) => o.misconception_id === 'js.mc.log-is-return');

    ctx.ai.provider.enqueue({
      text: JSON.stringify({
        proposals: [
          {
            catalogId: 'js.mc.log-is-return',
            newDescription: null,
            conceptId: 'js.basics.statement',
            evidenceAttemptIds: [second],
            confidence: 'high',
            reasoning: '출력을 반환으로 골랐음',
          },
          {
            catalogId: null,
            newDescription: '문장 끝 기호를 아무 기호나 써도 된다고 생각함',
            conceptId: 'js.basics.statement',
            evidenceAttemptIds: [first, 'not-an-input-attempt'],
            confidence: 'medium',
            reasoning: '콜론을 씀',
          },
          {
            catalogId: null,
            newDescription: '근거 없음',
            conceptId: 'js.basics.statement',
            evidenceAttemptIds: ['made-up'],
            confidence: 'high',
            reasoning: '',
          },
        ],
      }),
    });
    const result = await evaluator.proposeMisconceptions('js.basics.statement', {
      signals: ['요약: 기호를 헷갈려 함'],
    });
    expect(result?.recorded).toEqual([
      { misconceptionId: 'js.mc.log-is-return', status: before?.status ?? '', origin: 'catalog' },
      expect.objectContaining({ status: 'suspected', origin: 'ai' }),
    ]);
    expect(result?.issues.map((i) => i.rule)).toEqual(['evidence']);
    const req = ctx.ai.provider.requests.at(-1);
    expect(req).toMatchObject({ taskName: 'misconception.propose', effort: 'low' });
    expect(req?.input).toContain(`<attempt id="${second}"`);
    expect(req?.input).toContain('요약: 기호를 헷갈려 함');

    const after = observations(ctx);
    expect(after.find((o) => o.misconception_id === 'js.mc.log-is-return')).toEqual(before);
    const ai = after.find((o) => o.misconception_id.startsWith('ai.'));
    expect(ai).toMatchObject({
      status: 'suspected',
      source: 'ai',
      ai_description: '문장 끝 기호를 아무 기호나 써도 된다고 생각함',
    });
    expect(JSON.parse(ai?.evidence_attempt_ids_json ?? '[]')).toEqual([first]);

    const call = ctx.userDb.sqlite
      .prepare(
        "SELECT status, subject_type, subject_id FROM ai_calls WHERE task_name = 'misconception.propose'",
      )
      .get();
    expect(call).toEqual({ status: 'ok', subject_type: 'attempt', subject_id: second });
    // The newest wrong attempt was analyzed: not due again until a new one.
    expect(evaluator.dueProposalConcepts()).toEqual([]);
  });

  it('runs from the background sweep when a concept is due', async () => {
    const ctx = await practiceApp();
    await wrongAttempt(ctx, EX.fillText, { confidence: 'sure' });
    ctx.ai.provider.enqueue({ text: '{"proposals":[]}' });
    expect(await ctx.ai.memory.sweep()).toMatchObject({ proposed: 1, deferred: false });
    expect(ctx.ai.provider.requests.at(-1)?.taskName).toBe('misconception.propose');
    expect(await ctx.ai.memory.sweep()).toMatchObject({ proposed: 0 });
  });
});
