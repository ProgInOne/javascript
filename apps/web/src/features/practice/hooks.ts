import type { RunnerHost } from '@proginone/runner';
import type { RunPlan, RunResult } from '@proginone/run-contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { consoleRunner, previewRunner, warmRunner } from '../runner/runner.ts';

/**
 * Runner hosts for one exercise: the shared hidden host for console runs and grading (layout is
 * kept, so DOM/CSS checks work), and a visible host mounted into the PreviewFrame for web tasks.
 */
export function useExerciseRunner() {
  const previewMount = useRef<HTMLDivElement | null>(null);
  const previewHost = useRef<RunnerHost | null>(null);
  /** Notice about the current preview document (cleared by the next preview run). */
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  /** Title of the preview document for the tab bar (D-082); `null` before a document reports. */
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  useEffect(
    () => () => {
      previewHost.current?.dispose();
      previewHost.current = null;
    },
    [],
  );
  useEffect(() => warmRunner(), []);
  const hidden = useCallback((plan: RunPlan): Promise<RunResult> => consoleRunner().run(plan), []);
  /** Runs a `dom` plan as `preview`, so the document stays on screen after the run. */
  const preview = useCallback((plan: RunPlan): Promise<RunResult> => {
    const mount = previewMount.current;
    if (!mount) return consoleRunner().run(plan);
    setPreviewNotice(null);
    // The title stays until the new document reports its own (always, once it has parsed), so
    // the tab bar does not flicker on every run.
    previewHost.current ??= previewRunner(mount, {
      onNotice: setPreviewNotice,
      onTitle: setPreviewTitle,
    });
    return previewHost.current.run(plan.mode === 'dom' ? { ...plan, mode: 'preview' } : plan);
  }, []);
  const abort = useCallback(() => {
    consoleRunner().abort();
    previewHost.current?.abort();
  }, []);
  return { previewMount, previewNotice, previewTitle, hidden, preview, abort };
}

const IDLE_AFTER_MS = 60_000;
const TICK_MS = 1_000;

/**
 * Active solving time without idle gaps (attempts' `activeMs`): counts a second while the tab is
 * visible and the learner gave input within the last minute.
 */
export function useActiveTime() {
  const [startedAt] = useState(() => Date.now());
  const active = useRef(0);
  const lastInput = useRef(startedAt);
  useEffect(() => {
    const onInput = () => {
      lastInput.current = Date.now();
    };
    const events = ['keydown', 'pointerdown', 'scroll', 'input'] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true, capture: true });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastInput.current < IDLE_AFTER_MS)
        active.current += TICK_MS;
    }, TICK_MS);
    return () => {
      for (const e of events) window.removeEventListener(e, onInput, { capture: true });
      clearInterval(timer);
    };
  }, []);
  const read = useCallback(() => {
    const value = active.current;
    active.current = 0; // the next attempt (retry) counts from here
    return value;
  }, []);
  return { startedAt, readActiveMs: read };
}
