import type { SessionSummaryContent } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import type { SessionSummaryContext } from '../context/source.ts';
import { AIError } from '../errors.ts';
import { MockProvider } from '../provider/mock/mock-provider.ts';
import { TaskRunner } from '../runner.ts';
import { fakeSource } from '../test/fake-source.ts';
import {
  fallbackSummary,
  sanitizeSummary,
  sessionSummarize,
  SESSION_SUMMARY_JSON_SCHEMA,
} from './session-summarize.ts';
import { tutorReply } from './tutor-reply.ts';

// Long-term memory in the tasks: learner state with prerequisites, active misconceptions, thread
// and past summaries in tutor.reply, and session.summarize.

const noSleep = () => Promise.resolve();
const setup = () => {
  const provider = new MockProvider({ deltaDelayMs: 0 });
  return { provider, runner: new TaskRunner({ provider, now: () => 1_000, sleep: noSleep }) };
};

const summary = (over: Partial<SessionSummaryContext> = {}): SessionSummaryContext => ({
  id: 'S1',
  threadId: 'T1',
  createdAt: Date.UTC(2026, 10, 10),
  coveredUntil: 20,
  conceptIds: ['js.loops.for'],
  shortSummary: 'for 문의 누적 변수 초기화를 물었습니다.',
  struggles: [{ conceptId: 'js.loops.for', note: '초기값 없이 += 사용' }],
  openQuestions: ['while과의 차이'],
  misconceptionSignals: [],
  ...over,
});

const messages = [
  { id: 'M1', role: 'learner' as const, content: '처음 질문', createdAt: 10 },
  { id: 'M2', role: 'tutor' as const, content: '처음 답', createdAt: 20 },
  { id: 'M3', role: 'learner' as const, content: '요약 뒤 질문', createdAt: 30 },
  { id: 'M4', role: 'tutor' as const, content: '요약 뒤 답', createdAt: 40 },
];

const replyInput = {
  threadId: 'T1',
  question: '왜 NaN이 나와요?',
  entryPoint: 'free',
  exerciseId: 'js.ex.sum-even',
  access: { hintLevel: 0, solutionViewed: false },
};

describe('tutor.reply · learning state and memory', () => {
  it('sends prerequisites and active misconceptions every turn, confirmed first', async () => {
    const { provider, runner } = setup();
    const source = fakeSource({
      prerequisites: { 'js.loops.for': ['js.vars.let'] },
      misconceptions: [
        {
          id: 'js.mc.a',
          conceptId: 'js.loops.for',
          title: '의심 오개념',
          description: '의심 설명',
          status: 'suspected',
          origin: 'catalog',
          evidenceCount: 1,
        },
        {
          id: 'js.mc.b',
          conceptId: 'js.loops.for',
          title: '확정 오개념',
          description: '확정 설명',
          status: 'confirmed',
          origin: 'catalog',
          evidenceCount: 3,
        },
      ],
    });
    await runner.run(tutorReply, replyInput, {
      source,
      providerThread: { id: 'x', model: null, instructionsVersion: 'stale' },
    });
    const input = provider.requests[0]?.input ?? '';
    expect(input).toContain('<concept id="js.loops.for"');
    expect(input).toContain('<prerequisite id="js.vars.let" of="js.loops.for"');
    expect(input.indexOf('js.mc.b')).toBeLessThan(input.indexOf('js.mc.a'));
    expect(input).toContain('확정 오개념: 확정 설명');
  });

  it('rebuilds a thread from its summary and the messages after it, with related past summaries', async () => {
    const { provider, runner } = setup();
    const source = fakeSource({
      messages,
      summary: summary(),
      pastSummaries: [summary({ id: 'S0', threadId: 'T0', shortSummary: '지난주 반복문 대화' })],
    });
    const result = await runner.run(tutorReply, replyInput, { source, providerThread: null });
    const input = provider.requests[0]?.input ?? '';
    expect(input).toContain('<thread_summary');
    expect(input).toContain('for 문의 누적 변수 초기화를 물었습니다.');
    expect(input).toContain('요약 뒤 질문');
    expect(input).not.toContain('처음 질문');
    expect(input).toContain('<past_summaries>');
    expect(input).toContain('지난주 반복문 대화');
    const kinds = result.record.contextManifest.map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(['conversation_so_far', 'past_summaries']));
  });

  it('does not resend history or past summaries on a resumed thread', async () => {
    const { provider, runner } = setup();
    const source = fakeSource({ messages, summary: summary(), pastSummaries: [summary()] });
    const first = await runner.run(tutorReply, replyInput, { source, providerThread: null });
    await runner.run(tutorReply, replyInput, { source, providerThread: first.providerThread });
    const input = provider.requests[1]?.input ?? '';
    expect(input).not.toContain('<conversation_so_far>');
    expect(input).not.toContain('<past_summaries>');
  });

  it('rebuilds the thread when its history exceeds the context window', async () => {
    const { provider, runner } = setup();
    const source = fakeSource({ messages });
    const first = await runner.run(tutorReply, replyInput, { source, providerThread: null });
    provider.enqueue({ error: new AIError('AI_CONTEXT_TOO_LARGE') });
    const second = await runner.run(tutorReply, replyInput, {
      source,
      providerThread: first.providerThread,
    });
    expect(second.status).toBe('ok');
    expect(provider.requests[2]?.thread).toEqual({ kind: 'persistent', resumeId: null });
    expect(provider.requests[2]?.input).toContain('<conversation_so_far>');
  });
});

const valid: SessionSummaryContent = {
  conceptIds: ['js.loops.for', 'made.up'],
  topicsDiscussed: ['누적 변수'],
  learnerQuestions: ['왜 NaN?'],
  understoodWell: [{ conceptId: 'made.up', note: 'x' }],
  struggles: [
    { conceptId: 'js.loops.for', note: '초기값', evidenceMessageIds: ['M1', 'M9'] },
    { conceptId: 'js.loops.for', note: '근거 없음', evidenceMessageIds: ['M9'] },
  ],
  misconceptionSignals: [{ description: '+=가 0에서 시작한다고 생각', evidenceMessageIds: ['M3'] }],
  openQuestions: [],
  preferenceSignals: ['예제를 먼저 원함'],
  shortSummary: '요약',
};

describe('session.summarize', () => {
  it('reads the messages after the previous summary with their IDs and parses the summary', async () => {
    const { provider, runner } = setup();
    provider.enqueue({ text: JSON.stringify(valid) });
    const result = await runner.run(
      sessionSummarize,
      {
        threadId: 'T1',
        conceptIds: ['js.loops.for'],
        previousSummary: { ...valid, shortSummary: '이전 요약' },
        after: 20,
      },
      { source: fakeSource({ messages }) },
    );
    const req = provider.requests[0];
    expect(req?.thread).toEqual({ kind: 'ephemeral' });
    expect(req?.outputSchema).toBe(SESSION_SUMMARY_JSON_SCHEMA);
    expect(req?.input).toContain('<message id="M3" role="learner">');
    expect(req?.input).not.toContain('<message id="M1"');
    expect(req?.input).toContain('<previous_summary>');
    expect(result.output?.shortSummary).toBe('요약');
    expect(result.record).toMatchObject({ taskName: 'session.summarize', status: 'ok' });
  });

  it('clips overlong lists instead of failing the schema', async () => {
    const { provider, runner } = setup();
    provider.enqueue({
      text: JSON.stringify({
        ...valid,
        topicsDiscussed: Array.from({ length: 12 }, (_, i) => `t${i}`),
      }),
    });
    const result = await runner.run(
      sessionSummarize,
      { threadId: 'T1' },
      { source: fakeSource({ messages }) },
    );
    expect(result.output?.topicsDiscussed).toHaveLength(8);
  });

  it('keeps only evidence and concepts the server knows', () => {
    const { summary: clean, issues } = sanitizeSummary(valid, {
      messageIds: new Set(['M1', 'M3']),
      conceptIds: new Set(['js.loops.for']),
    });
    expect(clean.conceptIds).toEqual(['js.loops.for']);
    expect(clean.understoodWell).toEqual([]);
    expect(clean.struggles).toEqual([
      { conceptId: 'js.loops.for', note: '초기값', evidenceMessageIds: ['M1'] },
    ]);
    expect(clean.misconceptionSignals).toHaveLength(1);
    expect(issues.map((i) => i.rule)).toEqual(['concept', 'concept', 'evidence']);
  });

  it('falls back to a deterministic summary that keeps the previous one', () => {
    const out = fallbackSummary({
      messages: [
        { role: 'learner', content: '배열은 어떻게 \n 순회해요?' },
        { role: 'tutor', content: '...' },
      ],
      conceptIds: ['js.arrays.loop'],
      previous: { ...valid, shortSummary: '이전 요약' },
    });
    expect(out.conceptIds).toContain('js.arrays.loop');
    expect(out.learnerQuestions.at(-1)).toBe('배열은 어떻게 순회해요?');
    expect(out.shortSummary).toContain('이전 요약');
    expect(out.shortSummary).toContain('메시지 2개');
    expect(out.struggles).toEqual(valid.struggles);
  });
});
