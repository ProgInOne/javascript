import { describe, expect, it } from 'vitest';
import type { ProviderRequest } from '../types.ts';
import { MOCK_SLOW_MARKER, MockProvider } from './mock-provider.ts';

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

  it('keeps the normal pace without the marker', async () => {
    const mock = new MockProvider({ deltaDelayMs: 1 });
    const res = await mock.run(request('보통 질문'), { signal: new AbortController().signal });
    expect(res.text).toContain('보통 질문');
  });
});
