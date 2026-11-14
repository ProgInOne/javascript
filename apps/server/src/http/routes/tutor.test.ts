import { leakFingerprints } from '@proginone/exercise-kit';
import {
  aiHintResponseSchema,
  tutorStreamEventSchemas,
  tutorThreadDetailSchema,
  tutorThreadListSchema,
  tutorThreadSchema,
  type TutorStreamEventName,
} from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { markInterruptedMessages } from '../../db/user/tutor.ts';
import { WITHHELD_REPLY } from '../../services/tutor/tutor-service.ts';
import { ANSWER_MARKERS, EX, FIXTURE_EXERCISES } from '../../test/content-fixture.ts';
import { count, practiceApp } from '../../test/practice-app.ts';

type Ctx = Awaited<ReturnType<typeof practiceApp>>;

interface SseEvent {
  event: TutorStreamEventName;
  data: Record<string, unknown>;
}

/** Parses a complete SSE body and validates every payload with the shared schemas. */
function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n').filter((l) => !l.startsWith(':') && l !== '');
    if (lines.length === 0) continue;
    const event = lines
      .find((l) => l.startsWith('event:'))
      ?.slice(6)
      .trim() as TutorStreamEventName;
    const data = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    const parsed = tutorStreamEventSchemas[event].parse(JSON.parse(data)) as Record<
      string,
      unknown
    >;
    events.push({ event, data: parsed });
  }
  return events;
}

async function thread(ctx: Ctx, scopeType = 'exercise', scopeId: string | null = EX.implement) {
  const res = await ctx.call('POST', '/tutor/threads', {
    scopeType,
    ...(scopeId ? { scopeId } : {}),
  });
  return tutorThreadSchema.parse(res.json);
}

async function ask(ctx: Ctx, threadId: string, body: Record<string, unknown> = {}) {
  const res = await ctx.call('POST', `/tutor/threads/${threadId}/messages`, {
    question: '왜 테스트가 실패해요?',
    ...body,
  });
  return {
    status: res.status,
    events: res.status === 200 ? parseSse(res.text) : [],
    json: res.json,
  };
}

const lastInput = (ctx: Ctx) => ctx.ai.provider.requests.at(-1)?.input ?? '';
const fingerprint = (id: string) => {
  const ex = FIXTURE_EXERCISES.find((e) => e.id === id);
  if (!ex) throw new Error(id);
  return leakFingerprints(ex.type, ex.spec);
};

describe('tutor threads', () => {
  it('creates one open thread per scope and lists threads by recency', async () => {
    const ctx = await practiceApp();
    const first = await ctx.call('POST', '/tutor/threads', {
      scopeType: 'exercise',
      scopeId: EX.mcq,
    });
    expect(first.status).toBe(201);
    const again = await ctx.call('POST', '/tutor/threads', {
      scopeType: 'exercise',
      scopeId: EX.mcq,
    });
    expect(again.status).toBe(200);
    expect(tutorThreadSchema.parse(again.json).id).toBe(tutorThreadSchema.parse(first.json).id);
    await thread(ctx, 'general', null);
    const list = tutorThreadListSchema.parse(
      (await ctx.call('GET', '/tutor/threads?limit=1')).json,
    );
    expect(list.threads).toHaveLength(1);
    expect(list.nextCursor).not.toBeNull();
    const next = tutorThreadListSchema.parse(
      (await ctx.call('GET', `/tutor/threads?limit=1&cursor=${list.nextCursor ?? ''}`)).json,
    );
    expect(next.threads).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });

  it('validates scopes', async () => {
    const ctx = await practiceApp();
    expect((await ctx.call('POST', '/tutor/threads', { scopeType: 'exercise' })).status).toBe(400);
    expect(
      (await ctx.call('POST', '/tutor/threads', { scopeType: 'exercise', scopeId: 'nope.x' }))
        .status,
    ).toBe(404);
    expect(
      (await ctx.call('GET', '/tutor/threads/01JD3Z8Q6V2K9M4T7R1X5W0BNC/messages')).status,
    ).toBe(404);
  });
});

describe('POST /tutor/threads/:id/messages', () => {
  it('streams created → running → deltas → done and stores the turn with its AI call', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    ctx.ai.provider.enqueue({
      deltas: [
        'total이 ',
        '무엇을 돌려주는지 ',
        '확인해 볼까요?\n',
        '<meta>{"referencedConcepts":["js.basics.statement","no.such.concept"],"suggestedFollowUp":"try_exercise"}</meta>',
      ],
    });
    const { status, events } = await ask(ctx, t.id, {
      currentCode: { 'main.js': 'function shout(s) {}' },
    });
    expect(status).toBe(200);
    const names = events.map((e) => e.event);
    expect(names.slice(0, 2)).toEqual(['message.created', 'status']);
    expect(events[1]?.data).toMatchObject({ state: 'running' });
    expect(names.slice(2, -1).every((n) => n === 'delta')).toBe(true);
    expect(names.at(-1)).toBe('done');
    const created = events[0]?.data ?? {};
    const done = events.at(-1)?.data ?? {};
    expect(done).toMatchObject({
      messageId: created['messageId'],
      status: 'complete',
      content: 'total이 무엇을 돌려주는지 확인해 볼까요?',
      meta: { referencedConcepts: ['js.basics.statement'], suggestedFollowUp: 'try_exercise' },
    });
    const streamed = events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data['text'])
      .join('');
    expect(streamed).not.toContain('meta');

    const detail = tutorThreadDetailSchema.parse(
      (await ctx.call('GET', `/tutor/threads/${t.id}/messages`)).json,
    );
    expect(detail.thread).toMatchObject({ title: '왜 테스트가 실패해요?', messageCount: 2 });
    expect(detail.messages.map((m) => [m.role, m.status])).toEqual([
      ['learner', 'complete'],
      ['tutor', 'complete'],
    ]);
    const call = ctx.userDb.sqlite
      .prepare('SELECT task_name, status, subject_type, subject_id, provider FROM ai_calls')
      .get();
    expect(call).toEqual({
      task_name: 'tutor.reply',
      status: 'ok',
      subject_type: 'tutor_message',
      subject_id: created['messageId'],
      provider: 'mock',
    });
    expect(lastInput(ctx)).toContain('<learner_code file="main.js">');
  });

  it('resumes the cached provider thread and rebuilds it from the database when lost', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    ctx.ai.provider.enqueue({ text: '첫 답변이에요.' });
    await ask(ctx, t.id, { question: '첫 질문' });
    await ask(ctx, t.id, { question: '두 번째 질문' });
    expect(ctx.ai.provider.requests[1]?.thread).toEqual({
      kind: 'persistent',
      resumeId: 'mock-thread-1',
    });
    expect(lastInput(ctx)).not.toContain('conversation_so_far');

    ctx.ai.provider.forgetThreads();
    await ask(ctx, t.id, { question: '세 번째 질문' });
    expect(lastInput(ctx)).toContain('<conversation_so_far>');
    expect(lastInput(ctx)).toContain('첫 답변이에요.');
    expect(lastInput(ctx)).not.toContain('세 번째 질문</message>');
  });

  it('gives the AI answer keys only as far as the hint records allow (D-010)', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    const keyFree = (input: string) => {
      for (const marker of ANSWER_MARKERS) expect(input).not.toContain(marker);
    };
    await ask(ctx, t.id);
    keyFree(lastInput(ctx));
    expect(lastInput(ctx)).toContain('state="solving" hint_level="0"');
    expect(lastInput(ctx)).not.toContain('힌트 1');

    for (let level = 1; level <= 3; level++) {
      expect((await ctx.call('POST', `/exercises/${EX.implement}/hints`, {})).status).toBe(200);
      await ask(ctx, t.id);
      keyFree(lastInput(ctx));
      expect(lastInput(ctx)).toContain(`hint_level="${level}"`);
      expect(lastInput(ctx)).toContain(`힌트 ${level}`);
    }

    expect((await ctx.call('POST', `/exercises/${EX.implement}/solution`, {})).status).toBe(200);
    await ask(ctx, t.id);
    expect(lastInput(ctx)).toContain('state="solution_viewed"');
    expect(lastInput(ctx)).toContain('SOLUTION-MARK');
    // Hidden checks never reach the AI, even after the solution.
    expect(lastInput(ctx)).not.toContain('QUIET!');
  });

  it('never sends option rationales or the correct key of a choice exercise', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx, 'exercise', EX.mcq);
    await ask(ctx, t.id);
    expect(lastInput(ctx)).not.toContain('RATIONALE-MARK');
    expect(lastInput(ctx)).not.toContain('"correct"');
  });

  it('replaces a reply that leaks the reference answer, without streaming the leak', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    const [keyLine] = fingerprint(EX.implement);
    expect(keyLine).toBeTruthy();
    const leak = `이렇게 하면 돼요:\n\n    ${keyLine ?? ''}\n\n끝!`;
    ctx.ai.provider.enqueue({ deltas: [leak] }, { deltas: ['정답은 ', leak] });
    const { events } = await ask(ctx, t.id);
    const streamed = events
      .filter((e) => e.event === 'delta')
      .map((e) => String(e.data['text']))
      .join('');
    expect(streamed).not.toContain('toUpperCase');
    expect(events.at(-1)?.data).toMatchObject({ status: 'withheld', content: WITHHELD_REPLY });
    const stored = ctx.userDb.sqlite
      .prepare("SELECT status, content FROM tutor_messages WHERE role = 'tutor'")
      .get();
    expect(stored).toEqual({ status: 'withheld', content: WITHHELD_REPLY });
    const issues = ctx.userDb.sqlite
      .prepare('SELECT status, validation_issues_json FROM ai_calls')
      .get() as {
      status: string;
      validation_issues_json: string;
    };
    expect(issues.status).toBe('bad_output');
    expect(issues.validation_issues_json).toContain('answer_leak');
    expect(issues.validation_issues_json).not.toContain('toUpperCase');
  });

  it('does not check leaks once the solution was viewed', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    for (let i = 0; i < 3; i++) await ctx.call('POST', `/exercises/${EX.implement}/hints`, {});
    await ctx.call('POST', `/exercises/${EX.implement}/solution`, {});
    const [keyLine] = fingerprint(EX.implement);
    ctx.ai.provider.enqueue({ text: `정답 코드: ${keyLine ?? ''}` });
    const { events } = await ask(ctx, t.id);
    expect(events.at(-1)?.data['status']).toBe('complete');
  });

  it('retries a tool attempt with a reset event, then reports AI_BAD_OUTPUT', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx, 'general', null);
    ctx.ai.provider.enqueue(
      { deltas: ['ls를 실행할게요'], toolAttempt: true },
      { deltas: ['다시'], toolAttempt: true },
    );
    const { events } = await ask(ctx, t.id);
    expect(events.map((e) => e.event)).toContain('reset');
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'AI_BAD_OUTPUT' } });
    expect(ctx.userDb.sqlite.prepare('SELECT status, tool_attempts FROM ai_calls').get()).toEqual({
      status: 'bad_output',
      tool_attempts: 2,
    });
    expect(
      ctx.userDb.sqlite.prepare("SELECT status FROM tutor_messages WHERE role = 'tutor'").get(),
    ).toEqual({ status: 'failed' });
  });

  it('reports provider failures as an SSE error and stores the failed reply', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx, 'general', null);
    ctx.ai.provider.enqueue({ error: 'AI_RATE_LIMITED' });
    const { events } = await ask(ctx, t.id);
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: { code: 'AI_RATE_LIMITED', retryable: true },
    });
    expect(ctx.userDb.sqlite.prepare('SELECT status FROM ai_calls').get()).toEqual({
      status: 'rate_limited',
    });
  });

  it('cancels a running reply and keeps the partial text', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx, 'general', null);
    ctx.ai.provider.enqueue({ deltas: ['반복문은 '], hang: true });
    const res = await ctx.open('POST', `/tutor/threads/${t.id}/messages`, {
      question: '길게 설명해 줘',
    });
    const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    let text = '';
    let messageId: string | null = null;
    let cancelled = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      messageId ??= /"messageId":"([0-9A-Z]{26})"/.exec(text)?.[1] ?? null;
      if (messageId && !cancelled && text.includes('event: delta')) {
        cancelled = true;
        const cancel = await ctx.call(
          'POST',
          `/tutor/threads/${t.id}/messages/${messageId}/cancel`,
        );
        expect(cancel.json).toEqual({ messageId, cancelled: true });
      }
    }
    const events = parseSse(text);
    expect(events.at(-1)?.data).toMatchObject({ status: 'cancelled', content: '반복문은 ' });
    expect(
      ctx.userDb.sqlite
        .prepare("SELECT status, content FROM tutor_messages WHERE role = 'tutor'")
        .get(),
    ).toEqual({ status: 'cancelled', content: '반복문은 ' });
    const again = await ctx.call(
      'POST',
      `/tutor/threads/${t.id}/messages/${messageId ?? ''}/cancel`,
    );
    expect(again.json).toEqual({ messageId, cancelled: false });
  });

  it('serializes replies in one thread', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx, 'general', null);
    ctx.ai.provider.enqueue({ deltas: ['첫째'] }, { deltas: ['둘째'] });
    const [a, b] = await Promise.all([
      ask(ctx, t.id, { question: 'A' }),
      ask(ctx, t.id, { question: 'B' }),
    ]);
    const queued = [a, b].find((r) =>
      r.events.some((e) => e.event === 'status' && e.data['state'] === 'queued'),
    );
    expect(queued).toBeDefined();
    expect([a, b].every((r) => r.events.at(-1)?.data['status'] === 'complete')).toBe(true);
  });

  it('refuses before storing anything when AI is not connected', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    ctx.ai.provider.setStatus({ state: 'logged_out' });
    const res = await ask(ctx, t.id);
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ error: { code: 'AI_NOT_CONNECTED' } });
    expect(count(ctx, 'tutor_messages')).toBe(0);
  });

  it('locks the tutor in an assessment context (AI_LOCKED_IN_ASSESSMENT)', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    const learnerId = '01JD3Z8Q6V2K9M4T7R1X5W0BNC';
    ctx.userDb.sqlite
      .prepare(
        "INSERT INTO practice_sets (id, learner_id, kind, scope_json, engine_version, created_at) VALUES ('01JD3Z8Q6V2K9M4T7R1X5W0SET', ?, 'assessment', '{}', 'v', 1)",
      )
      .run(learnerId);
    ctx.userDb.sqlite
      .prepare(
        "INSERT INTO practice_set_items (id, learner_id, practice_set_id, position, exercise_id, exercise_origin, reason) VALUES ('01JD3Z8Q6V2K9M4T7R1X5W0ITM', ?, '01JD3Z8Q6V2K9M4T7R1X5W0SET', 0, ?, 'authored', 'assessment')",
      )
      .run(learnerId, EX.implement);
    const res = await ask(ctx, t.id, { practiceSetItemId: '01JD3Z8Q6V2K9M4T7R1X5W0ITM' });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ error: { code: 'AI_LOCKED_IN_ASSESSMENT' } });
    const hint = await ctx.call('POST', `/exercises/${EX.implement}/ai-hint`, {
      practiceSetItemId: '01JD3Z8Q6V2K9M4T7R1X5W0ITM',
    });
    expect(hint.status).toBe(403);
  });

  it('validates the body', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx);
    const res = await ctx.call('POST', `/tutor/threads/${t.id}/messages`, { question: '' });
    expect(res.status).toBe(400);
    const extra = await ctx.call('POST', `/tutor/threads/${t.id}/messages`, {
      question: 'x',
      access: {},
    });
    expect(extra.status).toBe(400);
  });
});

describe('startup cleanup', () => {
  it('marks replies left streaming as interrupted', async () => {
    const ctx = await practiceApp();
    const t = await thread(ctx, 'general', null);
    ctx.userDb.sqlite
      .prepare(
        "INSERT INTO tutor_messages (id, thread_id, role, content, status, created_at) VALUES ('M1', ?, 'tutor', '부분', 'streaming', 1)",
      )
      .run(t.id);
    expect(markInterruptedMessages(ctx.userDb.orm)).toBe(1);
    expect(
      ctx.userDb.sqlite.prepare("SELECT status, content FROM tutor_messages WHERE id = 'M1'").get(),
    ).toEqual({
      status: 'interrupted',
      content: '부분',
    });
    expect(markInterruptedMessages(ctx.userDb.orm)).toBe(0);
  });
});

describe('POST /exercises/:id/ai-hint', () => {
  it('needs an opened hint, then personalizes that level and records an ai_hint event', async () => {
    const ctx = await practiceApp();
    const none = await ctx.call('POST', `/exercises/${EX.implement}/ai-hint`, {});
    expect(none.status).toBe(409);
    expect(none.json).toMatchObject({ error: { code: 'EXERCISE_HINT_REQUIRED' } });

    await ctx.call('POST', `/exercises/${EX.implement}/hints`, {});
    const res = await ctx.call('POST', `/exercises/${EX.implement}/ai-hint`, {
      currentCode: { 'main.js': 'function shout(s) { return s; }' },
    });
    expect(res.status).toBe(200);
    expect(aiHintResponseSchema.parse(res.json)).toMatchObject({
      level: 1,
      source: 'ai',
      fallbackCode: null,
    });
    const input = lastInput(ctx);
    expect(input).toContain('힌트 1');
    expect(input).not.toContain('힌트 2');
    for (const marker of ANSWER_MARKERS) expect(input).not.toContain(marker);
    expect(
      ctx.userDb.sqlite.prepare("SELECT kind, level FROM hint_events WHERE kind = 'ai_hint'").all(),
    ).toEqual([{ kind: 'ai_hint', level: 1 }]);
    expect(
      ctx.userDb.sqlite.prepare('SELECT task_name, status, subject_type FROM ai_calls').get(),
    ).toEqual({
      task_name: 'tutor.hint',
      status: 'ok',
      subject_type: 'hint_event',
    });
    // An AI hint does not raise the authored hint level.
    const view = await ctx.call('GET', `/exercises/${EX.implement}`);
    expect((view.json as { openedHints: unknown[] }).openedHints).toHaveLength(1);
  });

  it('falls back to the authored hint when the AI hint leaks the answer', async () => {
    const ctx = await practiceApp();
    await ctx.call('POST', `/exercises/${EX.implement}/hints`, {});
    const [keyLine] = fingerprint(EX.implement);
    const leaking = JSON.stringify({
      level: 1,
      hintMarkdown: `힌트: ${keyLine ?? ''}`,
      focusLine: null,
      checkQuestion: null,
    });
    ctx.ai.provider.enqueue({ text: leaking }, { text: leaking });
    const res = await ctx.call('POST', `/exercises/${EX.implement}/ai-hint`, {});
    expect(res.json).toEqual({
      level: 1,
      hintMarkdown: '힌트 1',
      focusLine: null,
      checkQuestion: null,
      source: 'authored',
      fallbackCode: 'AI_BAD_OUTPUT',
    });
    expect(count(ctx, 'hint_events')).toBe(1);
    expect(ctx.userDb.sqlite.prepare('SELECT status FROM ai_calls').get()).toEqual({
      status: 'fallback',
    });
  });

  it('falls back when AI is not connected', async () => {
    const ctx = await practiceApp();
    await ctx.call('POST', `/exercises/${EX.implement}/hints`, {});
    ctx.ai.provider.setStatus({ state: 'logged_out' });
    const res = await ctx.call('POST', `/exercises/${EX.implement}/ai-hint`, {});
    expect(res.json).toMatchObject({ source: 'authored', fallbackCode: 'AI_NOT_CONNECTED' });
  });
});
