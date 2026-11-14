import type { HeartbeatRequest } from '@proginone/shared';
import { useEffect, useRef } from 'react';

export const HEARTBEAT_MS = 30_000;
/** No heartbeat when the last input is older than this (the server also stops counting). */
const IDLE_MS = 2 * 60_000;

/**
 * Activity heartbeat (learning-engine.md#학습-시간-측정): every 30 s while the tab is visible and
 * the learner gave keyboard/pointer/scroll input recently. The server decides what counts as
 * study time; failures are ignored (the next heartbeat carries the state).
 */
export function useActivityHeartbeat(send: (request: HeartbeatRequest) => Promise<unknown>) {
  const lastInput = useRef(0);
  const latest = useRef(send);
  useEffect(() => {
    latest.current = send;
  });
  useEffect(() => {
    lastInput.current = Date.now();
    const onInput = () => {
      lastInput.current = Date.now();
    };
    const events = ['keydown', 'pointerdown', 'wheel', 'scroll', 'input'] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true, capture: true });
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInput.current > IDLE_MS) return;
      latest
        .current({
          lastInputAt: lastInput.current,
          visible: true,
          focused: document.hasFocus(),
        })
        .catch(() => undefined);
    };
    const timer = setInterval(tick, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, onInput, { capture: true });
    };
  }, []);
}
