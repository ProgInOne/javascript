import {
  apiErrorSchema,
  exerciseViewSchema,
  hintResponseSchema,
  reportResponseSchema,
  runPlanSchema,
  solutionResponseSchema,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_KEY_FIELDS,
  ANSWER_MARKERS,
  BLOCK,
  EX,
  FIXTURE_EXERCISES,
} from '../../test/content-fixture.ts';
import { count, practiceApp } from '../../test/practice-app.ts';

function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

const errorCode = (json: unknown) => apiErrorSchema.parse(json).error.code;
const shoutAnswer = {
  files: [{ path: 'main.js', content: "function shout(s) { return s.toUpperCase() + '!'; }" }],
};

describe('GET /exercises/:id', () => {
  it.each(FIXTURE_EXERCISES.map((e) => [e.type, e.id]))(
    'returns the public view of %s without answer keys',
    async (_type, id) => {
      const { call } = await practiceApp();
      const res = await call('GET', `/exercises/${id}`);
      expect(res.status).toBe(200);
      const view = exerciseViewSchema.parse(res.json);
      expect(view.id).toBe(id);
      expect(view.hintCount).toBe(3);
      expect(view.openedHints).toEqual([]);
      const keys = keysOf(view.publicSpec);
      for (const field of ANSWER_KEY_FIELDS) expect(keys).not.toContain(field);
      for (const marker of ANSWER_MARKERS) expect(res.text).not.toContain(marker);
      expect(res.text).not.toContain('해설'); // explanation only after "정답 보기"
      expect(res.text).not.toContain('힌트 1'); // hint texts only once opened
    },
  );

  it('marks run-based specs', async () => {
    const { call } = await practiceApp();
    const view = async (id: string) =>
      exerciseViewSchema.parse((await call('GET', `/exercises/${id}`)).json);
    expect((await view(EX.mcq)).requiresRun).toBe(false);
    expect((await view(EX.fillText)).requiresRun).toBe(false);
    expect((await view(EX.predict)).requiresRun).toBe(false);
    expect((await view(EX.fillCode)).requiresRun).toBe(true);
    expect((await view(EX.implement)).category).toBe('production');
  });

  it('marks writing exercises (작성형, D-084)', async () => {
    const { call } = await practiceApp();
    const view = async (id: string) =>
      exerciseViewSchema.parse((await call('GET', `/exercises/${id}`)).json);
    expect((await view(EX.implement)).writing).toBe(true);
    expect((await view(EX.fixBug)).writing).toBe(false);
    expect((await view(EX.web)).writing).toBe(false); // the starter has markup to edit
    expect((await view(EX.mcq)).writing).toBe(false);
  });

  it('labels the code with the language of the exercise course', async () => {
    const { call } = await practiceApp();
    const view = exerciseViewSchema.parse((await call('GET', `/exercises/${EX.mcq}`)).json);
    expect(view.codeLanguage).toBe('javascript');
  });

  it('answers 404 for unknown or malformed ids and items', async () => {
    const { call } = await practiceApp();
    expect((await call('GET', '/exercises/nope.nope.nope.nope')).status).toBe(404);
    expect((await call('GET', '/exercises/%20bad')).status).toBe(404);
    const res = await call(
      'GET',
      `/exercises/${EX.mcq}?practiceSetItemId=01JD3Z8Q6V2K9M4T7R1X5W0BNC`,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /exercises/:id/run-plan', () => {
  it('builds a grading plan without expected values', async () => {
    const { call } = await practiceApp();
    const res = await call('POST', `/exercises/${EX.implement}/run-plan`, {
      answer: shoutAnswer,
      purpose: 'grading',
    });
    expect(res.status).toBe(200);
    const plan = runPlanSchema.parse(res.json);
    expect(plan.checks.steps.map((s) => s.id)).toEqual(['settle', 'basic#0', 'hidden#0']);
    for (const marker of ANSWER_MARKERS) expect(res.text).not.toContain(marker);
    expect(res.text).not.toContain('HI!');
  });

  it('keeps only visible checks for interactive runs', async () => {
    const { call } = await practiceApp();
    const res = await call('POST', `/exercises/${EX.web}/run-plan`, {
      answer: { files: [{ path: 'index.html', content: '<ul class="cards"></ul>' }] },
      purpose: 'interactive',
    });
    const plan = runPlanSchema.parse(res.json);
    expect(plan.checks.steps.map((s) => s.id)).toEqual(['settle', 'has-list#q']);
  });

  it('refuses types that are not graded from a run', async () => {
    const { call } = await practiceApp();
    for (const id of [EX.mcq, EX.predict, EX.fillText]) {
      const res = await call('POST', `/exercises/${id}/run-plan`, {
        answer: {},
        purpose: 'interactive',
      });
      expect(res.status).toBe(409);
      expect(errorCode(res.json)).toBe('EXERCISE_NOT_RUNNABLE');
    }
  });

  it('validates the answer and the purpose', async () => {
    const { call } = await practiceApp();
    const bad = await call('POST', `/exercises/${EX.implement}/run-plan`, {
      answer: { files: 'nope' },
      purpose: 'grading',
    });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.json)).toBe('VALIDATION_ANSWER_INVALID');
    const verification = await call('POST', `/exercises/${EX.implement}/run-plan`, {
      answer: shoutAnswer,
      purpose: 'verification',
    });
    expect(verification.status).toBe(400);
    expect(errorCode(verification.json)).toBe('VALIDATION_FAILED');
    const proto = await call(
      'POST',
      `/exercises/${EX.implement}/run-plan`,
      '{"purpose":"grading","answer":{"__proto__":{"files":[]}}}',
    );
    expect(proto.status).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const { call } = await practiceApp();
    const res = await call('POST', `/exercises/${EX.implement}/run-plan`, {
      answer: { files: [{ path: 'main.js', content: 'x'.repeat(1_100_000) }] },
      purpose: 'grading',
    });
    expect(res.status).toBe(413);
  });
});

describe('hints and solution', () => {
  it('opens hint levels 1 to 3 and then refuses', async () => {
    const ctx = await practiceApp();
    for (const level of [1, 2, 3]) {
      const res = await ctx.call('POST', `/exercises/${EX.mcq}/hints`);
      expect(res.status).toBe(200);
      expect(hintResponseSchema.parse(res.json)).toEqual({
        level,
        text: `힌트 ${level}`,
        hintCount: 3,
        remaining: 3 - level,
      });
    }
    const fourth = await ctx.call('POST', `/exercises/${EX.mcq}/hints`, {});
    expect(fourth.status).toBe(409);
    expect(errorCode(fourth.json)).toBe('EXERCISE_HINTS_EXHAUSTED');
    expect(count(ctx, 'hint_events')).toBe(3);
    const view = exerciseViewSchema.parse((await ctx.call('GET', `/exercises/${EX.mcq}`)).json);
    expect(view.openedHints.map((h) => h.level)).toEqual([1, 2, 3]);
  });

  it("waits for one submission under hints.policy 'after-attempt' (D-047)", async () => {
    const ctx = await practiceApp();
    const patched = await ctx.call('PATCH', '/settings', { 'hints.policy': 'after-attempt' });
    expect(patched.status).toBe(200);
    const early = await ctx.call('POST', `/exercises/${BLOCK.checkMcq}/hints`);
    expect(early.status).toBe(409);
    expect(errorCode(early.json)).toBe('EXERCISE_TRY_FIRST');
    expect(count(ctx, 'hint_events')).toBe(0);

    const attempt = await ctx.call('POST', `/exercises/${BLOCK.checkMcq}/inline-attempts`, {
      answer: { optionId: 'a' },
      startedAt: ctx.clock.now - 20_000,
      activeMs: 15_000,
      confidence: null,
    });
    expect(attempt.status).toBe(201);
    const after = await ctx.call('POST', `/exercises/${BLOCK.checkMcq}/hints`);
    expect(after.status).toBe(200);
    expect(hintResponseSchema.parse(after.json).level).toBe(1);

    // A try task records no submissions; the lesson keeps its first-try rule (D-091).
    expect((await ctx.call('POST', `/exercises/${BLOCK.tryShout}/hints`)).status).toBe(200);

    // Back to standard: no submission needed.
    await ctx.call('PATCH', '/settings', { 'hints.policy': 'standard' });
    expect((await ctx.call('POST', `/exercises/${EX.implement}/hints`)).status).toBe(200);
  });

  it('locks the solution until all hints are open, then records one view', async () => {
    const ctx = await practiceApp();
    const locked = await ctx.call('POST', `/exercises/${EX.implement}/solution`);
    expect(locked.status).toBe(409);
    expect(errorCode(locked.json)).toBe('EXERCISE_SOLUTION_LOCKED');
    for (let i = 0; i < 3; i++) await ctx.call('POST', `/exercises/${EX.implement}/hints`);

    const res = await ctx.call('POST', `/exercises/${EX.implement}/solution`);
    expect(res.status).toBe(200);
    const body = solutionResponseSchema.parse(res.json);
    expect(body.explanation).toBe(`${EX.implement} 해설`);
    expect(body.solution.kind).toBe('files');
    expect(res.text).toContain('SOLUTION-MARK');
    expect(res.text).not.toContain('QUIET!'); // hidden checks stay hidden
    await ctx.call('POST', `/exercises/${EX.implement}/solution`);
    const solutionEvents = ctx.userDb.sqlite
      .prepare("SELECT COUNT(*) AS n FROM hint_events WHERE kind = 'solution'")
      .get() as { n: number };
    expect(solutionEvents.n).toBe(1);
    const view = exerciseViewSchema.parse(
      (await ctx.call('GET', `/exercises/${EX.implement}`)).json,
    );
    expect(view.solutionViewed).toBe(true);
  });

  it('shows the reference answer per type', async () => {
    const ctx = await practiceApp();
    const solution = async (id: string) => {
      for (let i = 0; i < 3; i++) await ctx.call('POST', `/exercises/${id}/hints`);
      return solutionResponseSchema.parse(
        (await ctx.call('POST', `/exercises/${id}/solution`)).json,
      ).solution;
    };
    expect(await solution(EX.mcq)).toEqual({
      kind: 'choice',
      choiceId: 'b',
      text: '`2`를 출력한다',
    });
    expect(await solution(EX.fillText)).toEqual({
      kind: 'blanks',
      blanks: [{ id: 'b1', answer: ';' }],
    });
    expect(await solution(EX.predict)).toEqual({ kind: 'console', lines: ['2'] });
    expect((await solution(EX.web)).kind).toBe('files');
  });
});

describe('POST /exercises/:id/reports', () => {
  it('records a report that excludes the exercise', async () => {
    const ctx = await practiceApp();
    const res = await ctx.call('POST', `/exercises/${EX.predict}/reports`, {
      reason: 'unclear',
      note: '  출력이 두 줄일 수도 있어요  ',
    });
    expect(res.status).toBe(201);
    expect(reportResponseSchema.parse(res.json).excluded).toBe(true);
    const row = ctx.userDb.sqlite
      .prepare(
        'SELECT exercise_id, reason, exercise_origin, excluded, note, status FROM exercise_reports',
      )
      .get();
    expect(row).toEqual({
      exercise_id: EX.predict,
      reason: 'unclear',
      exercise_origin: 'authored',
      excluded: 1,
      note: '출력이 두 줄일 수도 있어요',
      status: 'open',
    });
  });

  it('validates the reason', async () => {
    const { call } = await practiceApp();
    const res = await call('POST', `/exercises/${EX.predict}/reports`, { reason: 'boring' });
    expect(res.status).toBe(400);
    expect(errorCode(res.json)).toBe('VALIDATION_FAILED');
  });
});
