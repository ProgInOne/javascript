import type { HeartbeatRequest } from '@proginone/shared';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, lessonIdOfPath, useActivityHeartbeat } from './useActivityHeartbeat.ts';

// Activity heartbeat with the lesson on screen (learning-engine.md#학습-시간-측정, FR-GOAL-02).

function Beat({
  send,
  lessonId,
}: {
  send: (r: HeartbeatRequest) => Promise<unknown>;
  lessonId?: string;
}) {
  useActivityHeartbeat(send, lessonId);
  return null;
}

describe('useActivityHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the lesson on screen with each beat, read at beat time', () => {
    const send = vi.fn((_: HeartbeatRequest) => Promise.resolve());
    const view = render(<Beat send={send} lessonId="js-basics.start.first-program" />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      visible: true,
      lessonId: 'js-basics.start.first-program',
    });

    // Leaving the learning screen: later beats carry no lesson.
    view.rerender(<Beat send={send} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).not.toHaveProperty('lessonId');
  });

  it('finds the lesson of a learning-screen path', () => {
    expect(lessonIdOfPath('/learn/js-basics.start.first-program')).toBe(
      'js-basics.start.first-program',
    );
    expect(lessonIdOfPath('/learn/a%2Eb/')).toBe('a.b');
    expect(lessonIdOfPath('/review')).toBeUndefined();
    expect(lessonIdOfPath('/learn/%E0%A4%A')).toBeUndefined();
  });
});
