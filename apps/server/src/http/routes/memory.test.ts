import { MockProvider, TaskRunner } from '@proginone/ai';
import {
  summarizeTutorThreadResponseSchema,
  tutorThreadSchema,
  tutorThreadSummaryResponseSchema,
  type SessionSummaryContent,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { AiService } from '../../services/ai/ai-service.ts';
import { MemoryService } from '../../services/tutor/memory-service.ts';
import { TutorService } from '../../services/tutor/tutor-service.ts';
import { EX } from '../../test/content-fixture.ts';
import { silentLog } from '../../test/helpers.ts';
import { count, DAY, MINUTE, practiceApp } from '../../test/practice-app.ts';
import { errorCode, lessonSet, submit } from '../../test/practice-flow.ts';

// Long-term memory (docs/design/ai-system.md#장기-학습-기억): session.summarize into
// session_summaries, the learning state in the tutor's context, and rebuilding a conversation
// after an app restart from stored messages and summaries.

type Ctx = Awaited<ReturnType<typeof practiceApp>>;

async function thread(ctx: Ctx, scopeType = 'exercise', scopeId: string | null = EX.implement) {
  const res = await ctx.call('POST', '/tutor/threads', {
    scopeType,
    ...(scopeId ? { scopeId } : {}),
  });
  return tutorThreadSchema.parse(res.json);
}

/** One question and a complete reply (mock answers deterministically unless scripted). */
async function ask(ctx: Ctx, threadId: string, question: string) {
  ctx.clock.now += MINUTE;
  const res = await ctx.call('POST', `/tutor/threads/${threadId}/messages`, { question });
  expect(res.status).toBe(200);
  expect(res.text).toContain('"status":"complete"');
}

const messageIds = (ctx: Ctx, threadId: string) =>
  (
    ctx.userDb.sqlite
      .prepare('SELECT id FROM tutor_messages WHERE thread_id = ? ORDER BY created_at')
      .all(threadId) as { id: string }[]
  ).map((r) => r.id);

const summaryJson = (over: Partial<SessionSummaryContent> = {}): string =>
  JSON.stringify({
    conceptIds: ['js.basics.statement', 'no.such.concept'],
    topicsDiscussed: ['console.log와 반환값'],
    learnerQuestions: ['console.log가 값을 돌려주나요?'],
    understoodWell: [],
    struggles: [],
    misconceptionSignals: [],
    openQuestions: [],
    preferenceSignals: [],
    shortSummary: 'console.log의 출력과 반환을 헷갈려 했습니다.',
    ...over,
  } satisfies SessionSummaryContent);

describe('session.summarize · POST/GET /tutor/threads/:id/summary', () => {
  it('stores a rolling summary with only backed evidence, and records the AI call', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    await ask(ctx, t.id, 'console.log가 값을 돌려주나요?');
    const [question] = messageIds(ctx, t.id);
    ctx.ai.provider.enqueue({
      text: summaryJson({
        struggles: [
          {
            conceptId: 'js.basics.statement',
            note: '출력과 반환',
            evidenceMessageIds: [question ?? ''],
          },
          { conceptId: 'js.basics.statement', note: '근거 없음', evidenceMessageIds: ['made-up'] },
        ],
      }),
    });
    const res = await ctx.call('POST', `/tutor/threads/${t.id}/summary`);
    expect(res.status).toBe(200);
    const out = summarizeTutorThreadResponseSchema.parse(res.json);
    expect(out.created).toBe(true);
    expect(out.summary).toMatchObject({
      scopeType: 'tutor_thread',
      scopeId: t.id,
      source: 'ai',
      messageCount: 2,
      content: {
        conceptIds: ['js.basics.statement'],
        struggles: [{ note: '출력과 반환', evidenceMessageIds: [question] }],
      },
    });
    const req = ctx.ai.provider.requests.at(-1);
    expect(req).toMatchObject({ taskName: 'session.summarize', thread: { kind: 'ephemeral' } });
    expect(req?.input).toContain(`<message id="${question}" role="learner">`);

    const call = ctx.userDb.sqlite
      .prepare(
        "SELECT status, subject_type, subject_id, provider, model, task_version, base_version, validation_issues_json FROM ai_calls WHERE task_name = 'session.summarize'",
      )
      .get() as Record<string, unknown>;
    expect(call).toMatchObject({
      status: 'ok',
      subject_type: 'tutor_thread',
      subject_id: t.id,
      provider: 'mock',
      task_version: 1,
      base_version: 2,
    });
    expect(String(call['model'])).toBe('mock-tutor');
    expect(JSON.parse(String(call['validation_issues_json']))).toEqual([
      expect.objectContaining({ rule: 'concept' }),
      expect.objectContaining({ rule: 'evidence' }),
    ]);

    const got = tutorThreadSummaryResponseSchema.parse(
      (await ctx.call('GET', `/tutor/threads/${t.id}/summary`)).json,
    );
    expect(got.summary?.id).toBe(out.summary?.id);
    // Nothing new: no AI call.
    const again = summarizeTutorThreadResponseSchema.parse(
      (await ctx.call('POST', `/tutor/threads/${t.id}/summary`)).json,
    );
    expect(again).toMatchObject({ created: false, summary: { id: out.summary?.id } });

    // Rolling: the next summary reads only newer messages and the previous summary.
    await ask(ctx, t.id, '그럼 return은 언제 쓰나요?');
    ctx.ai.provider.enqueue({ text: summaryJson({ shortSummary: '두 번째 요약' }) });
    const second = summarizeTutorThreadResponseSchema.parse(
      (await ctx.call('POST', `/tutor/threads/${t.id}/summary`)).json,
    );
    expect(second.summary).toMatchObject({
      messageCount: 4,
      content: { shortSummary: '두 번째 요약' },
    });
    const input = ctx.ai.provider.requests.at(-1)?.input ?? '';
    expect(input).toContain('<previous_summary>');
    expect(input).toContain('그럼 return은 언제 쓰나요?');
    expect(input).not.toContain('<message id="' + (question ?? '') + '"');
    expect(count(ctx, 'session_summaries')).toBe(2);
  });

  it('writes the deterministic summary when the output stays invalid', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    await ask(ctx, t.id, '세미콜론은 꼭 써야 하나요?');
    ctx.ai.provider.enqueue({ text: 'not json' }, { text: '{"also": "wrong"}' });
    const out = summarizeTutorThreadResponseSchema.parse(
      (await ctx.call('POST', `/tutor/threads/${t.id}/summary`)).json,
    );
    expect(out.summary).toMatchObject({
      source: 'fallback',
      content: {
        learnerQuestions: ['세미콜론은 꼭 써야 하나요?'],
        conceptIds: ['js.basics.statement', 'js.basics.comment'],
      },
    });
    const call = ctx.userDb.sqlite
      .prepare("SELECT status, retries FROM ai_calls WHERE task_name = 'session.summarize'")
      .get();
    expect(call).toEqual({ status: 'fallback', retries: 1 });
  });

  it('reports AI_NOT_CONNECTED for a manual summary when AI is unavailable', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    await ask(ctx, t.id, '질문');
    ctx.ai.provider.setStatus({ state: 'logged_out' });
    const res = await ctx.call('POST', `/tutor/threads/${t.id}/summary`);
    expect(res.status).toBe(409);
    expect(errorCode(res.json)).toBe('AI_NOT_CONNECTED');
    expect(count(ctx, 'session_summaries')).toBe(0);
  });

  it('404s for an unknown thread', async () => {
    const ctx = await practiceApp();
    expect(
      (await ctx.call('GET', '/tutor/threads/01JD3Z8Q6V2K9M4T7R1X5W0ZZZ/summary')).status,
    ).toBe(404);
  });
});

describe('background summaries (sweep)', () => {
  it('summarizes threads idle for 30 minutes, defers at 80% usage, and falls back after 7 days', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    await ask(ctx, t.id, '첫 질문');
    const memory = ctx.ai.memory;

    ctx.clock.now += 10 * MINUTE;
    expect(await memory.sweep()).toEqual({ summarized: 0, fallbacks: 0, deferred: false });

    ctx.clock.now += 25 * MINUTE;
    ctx.ai.provider.setUsage({
      windows: [{ id: 'primary', usedPercent: 85, windowDurationMins: 10_080, resetsAt: null }],
      highestUsedPercent: 85,
      updatedAt: ctx.clock.now,
    });
    expect(await memory.sweep()).toEqual({ summarized: 0, fallbacks: 0, deferred: true });
    expect(count(ctx, 'session_summaries')).toBe(0);

    ctx.ai.provider.setUsage({
      windows: [{ id: 'primary', usedPercent: 10, windowDurationMins: 10_080, resetsAt: null }],
      highestUsedPercent: 10,
      updatedAt: ctx.clock.now,
    });
    ctx.ai.provider.enqueue({ text: summaryJson() });
    expect(await memory.sweep()).toEqual({ summarized: 1, fallbacks: 0, deferred: false });
    expect(await memory.sweep()).toEqual({ summarized: 0, fallbacks: 0, deferred: false });

    // A new exchange while AI is unavailable waits, then falls back after seven days.
    await ask(ctx, t.id, '두 번째 질문');
    ctx.ai.provider.setStatus({ state: 'logged_out' });
    ctx.clock.now += 2 * DAY;
    expect(await memory.sweep()).toMatchObject({ fallbacks: 0, deferred: true });
    ctx.clock.now += 6 * DAY;
    expect(await memory.sweep()).toMatchObject({ fallbacks: 1, deferred: true });
    const latest = tutorThreadSummaryResponseSchema.parse(
      (await ctx.call('GET', `/tutor/threads/${t.id}/summary`)).json,
    );
    expect(latest.summary).toMatchObject({ source: 'fallback', messageCount: 4 });
    expect(latest.summary?.content.shortSummary).toContain('console.log의 출력과 반환');
  });
});

describe('tutor context · learning state and memory', () => {
  it('sends prerequisites and the misconceptions the learner showed', async () => {
    const ctx = await practiceApp();
    const set = await lessonSet(ctx);
    const mcq = set.items.find((i) => i.exerciseId === EX.mcq);
    if (!mcq) throw new Error('no mcq item');
    expect((await submit(ctx, mcq, { correct: false })).status).toBe(201);
    const t = await thread(ctx, 'exercise', EX.mcq);
    await ask(ctx, t.id, '어디가 틀렸어요?');
    const input = ctx.ai.provider.requests.at(-1)?.input ?? '';
    expect(input).toContain('<concept id="js.basics.statement"');
    expect(input).toContain('<prerequisite id="js.basics.comment" of="js.basics.statement"');
    expect(input).toMatch(
      /<misconception id="js\.mc\.log-is-return"[^>]*status="(suspected|confirmed)"/,
    );
    expect(input).toContain('출력하면 값이 돌아온다고 생각합니다.');
  });

  it('brings in summaries of related conversations when a new thread starts', async () => {
    const ctx = await practiceApp();
    const lessonThread = await thread(ctx, 'lesson', 'js-basics.start.first-program');
    await ask(ctx, lessonThread.id, '문장이 뭐예요?');
    ctx.ai.provider.enqueue({ text: summaryJson({ shortSummary: '레슨 대화 요약 PAST-MARK' }) });
    await ctx.call('POST', `/tutor/threads/${lessonThread.id}/summary`);
    const t = await thread(ctx);
    await ask(ctx, t.id, '이 문제는 어떻게 풀어요?');
    const input = ctx.ai.provider.requests.at(-1)?.input ?? '';
    expect(input).toContain('<past_summaries>');
    expect(input).toContain('PAST-MARK');
  });

  it('restores a conversation after an app restart from the stored summary and messages', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    await ask(ctx, t.id, '첫 질문 OLD-MARK');
    ctx.ai.provider.enqueue({ text: summaryJson({ shortSummary: '요약된 앞부분 SUMMARY-MARK' }) });
    await ctx.call('POST', `/tutor/threads/${t.id}/summary`);
    await ask(ctx, t.id, '요약 뒤 질문 RECENT-MARK');

    // "Restart": new provider (its threads are gone), runner and services over the same user.db.
    const provider = new MockProvider({ deltaDelayMs: 0 });
    const ai = new AiService({ provider, log: silentLog });
    const runner = new TaskRunner({
      provider,
      now: () => ctx.clock.now,
      sleep: () => Promise.resolve(),
    });
    const deps = {
      userDb: ctx.userDb,
      content: ctx.content,
      runner,
      ai,
      now: () => ctx.clock.now,
      log: silentLog,
    };
    const tutor = new TutorService({ ...deps, memory: new MemoryService(deps) });
    const turn = await tutor.prepareMessage(t.id, { question: '이어서 질문', entryPoint: 'free' });
    const events: string[] = [];
    await turn.run((event) => events.push(event));
    expect(events.at(-1)).toBe('done');

    // The cached provider thread could not be resumed, so it was rebuilt from the database.
    const rebuilt = provider.requests.at(-1);
    expect(rebuilt?.thread).toEqual({ kind: 'persistent', resumeId: null });
    expect(provider.requests[0]?.thread).toMatchObject({
      kind: 'persistent',
      resumeId: 'mock-thread-1',
    });
    const input = rebuilt?.input ?? '';
    expect(input).toContain('<thread_summary');
    expect(input).toContain('SUMMARY-MARK');
    expect(input).toContain('RECENT-MARK');
    expect(input).not.toContain('OLD-MARK');
    const stored = ctx.userDb.sqlite
      .prepare('SELECT provider_thread_id FROM tutor_threads WHERE id = ?')
      .get(t.id) as { provider_thread_id: string };
    expect(stored.provider_thread_id).toBe('mock-thread-1');
  });

  it('summarizes a long unsummarized thread before rebuilding it', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    for (let i = 0; i < 8; i++) await ask(ctx, t.id, `질문 ${i}`);
    // Lose the provider thread (model or instructions changed, or Codex lost it).
    ctx.userDb.sqlite
      .prepare('UPDATE tutor_threads SET provider_instructions_version = ?')
      .run('old');
    ctx.ai.provider.enqueue({ text: summaryJson({ shortSummary: '롤링 요약 ROLL-MARK' }) });
    await ask(ctx, t.id, '이어서');
    const tasks = ctx.ai.provider.requests.slice(-2).map((r) => r.taskName);
    expect(tasks).toEqual(['session.summarize', 'tutor.reply']);
    const summarize = ctx.ai.provider.requests.at(-2)?.input ?? '';
    expect(summarize).not.toContain('이어서');
    expect(ctx.ai.provider.requests.at(-1)?.input).toContain('ROLL-MARK');
  });
});
