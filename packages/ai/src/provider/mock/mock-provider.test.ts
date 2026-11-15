import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRequest } from '../types.ts';
import { MOCK_SLOW_MARKER, MockProvider, SLOW_HOLD_BEFORE, SLOW_HOLD_MS } from './mock-provider.ts';

const request = (question: string): ProviderRequest => ({
  taskName: 'tutor.reply',
  baseInstructions: '',
  developerInstructions: '',
  input: `<learner_question entry_point="free">\n${question}\n</learner_question>`,
  effort: 'low',
  thread: { kind: 'ephemeral' },
  timeoutMs: 10_000,
});

describe('MockProvider slow marker', () => {
  it('streams an unscripted reply slowly so it can be cancelled in flight', async () => {
    const mock = new MockProvider({ deltaDelayMs: 1 });
    const controller = new AbortController();
    const deltas: string[] = [];
    const started = Date.now();
    const run = mock.run(request(`${MOCK_SLOW_MARKER} 천천히`), {
      signal: controller.signal,
      onDelta: (d) => {
        deltas.push(d);
        controller.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(deltas).toHaveLength(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });

  describe('hold before the held sentence', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('streams up to the held sentence, then waits for the cancel and keeps the partial text', async () => {
      vi.useFakeTimers();
      const mock = new MockProvider({ deltaDelayMs: 1 });
      const controller = new AbortController();
      let streamed = '';
      const run = mock.run(request(`${MOCK_SLOW_MARKER} 천천히`), {
        signal: controller.signal,
        onDelta: (d) => {
          streamed += d;
        },
      });
      const settled = run.then(
        () => 'resolved',
        (e: unknown) => e,
      );
      // Long after the whole reply would have streamed, it stops short of the held sentence.
      await vi.advanceTimersByTimeAsync(SLOW_HOLD_MS - 1_000);
      expect(streamed).toContain('(모의 튜터) "[mock:slow] 천천히"에 대해 함께 생각해 볼게요.');
      expect(streamed).not.toContain(SLOW_HOLD_BEFORE);
      expect(streamed.length).toBeGreaterThanOrEqual(60);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(await settled).toMatchObject({ code: 'AI_CANCELLED', partialText: streamed });
    });

    it('finishes the reply after the hold when nobody cancels', async () => {
      vi.useFakeTimers();
      const mock = new MockProvider({ deltaDelayMs: 1 });
      const run = mock.run(request(`${MOCK_SLOW_MARKER} 천천히`), {
        signal: new AbortController().signal,
      });
      await vi.advanceTimersByTimeAsync(SLOW_HOLD_MS + 60_000);
      expect((await run).text).toContain('한 문장으로 정리해 보세요');
    });
  });

  it('keeps the normal pace without the marker', async () => {
    const mock = new MockProvider({ deltaDelayMs: 1 });
    const res = await mock.run(request('보통 질문'), { signal: new AbortController().signal });
    expect(res.text).toContain('보통 질문');
  });
});

describe('MockProvider error marker', () => {
  it('fails an unscripted reply with the marked AI error, keeping the provider ready', async () => {
    const mock = new MockProvider({ deltaDelayMs: 1 });
    const signal = new AbortController().signal;
    await expect(
      mock.run(request('[mock:error:AI_RATE_LIMITED] 질문'), { signal }),
    ).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
    await expect(mock.run(request('[mock:error:AI_TIMEOUT]'), { signal })).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
    });
    expect(mock.currentStatus().state).toBe('ready');
    // Unknown codes are ignored.
    const res = await mock.run(request('[mock:error:AI_NOPE]'), { signal });
    expect(res.text).toContain('모의 튜터');
  });
});
