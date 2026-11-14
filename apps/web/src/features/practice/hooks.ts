import type { RunnerHost } from '@proginone/runner';
import type { RunPlan, RunResult } from '@proginone/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { consoleRunner, previewRunner } from '../runner/runner.ts';

/**
 * Runner hosts for one exercise: the shared hidden host for console runs and grading (layout is
 * kept, so DOM/CSS checks work), and a visible host mounted into the PreviewFrame for web tasks.
 */
export function useExerciseRunner() {
  const previewMount = useRef<HTMLDivElement | null>(null);
  const previewHost = useRef<RunnerHost | null>(null);
  useEffect(
    () => () => {
      previewHost.current?.dispose();
      previewHost.current = null;
    },
    [],
  );
  const hidden = useCallback((plan: RunPlan): Promise<RunResult> => consoleRunner().run(plan), []);
  /** Runs a `dom` plan as `preview`, so the document stays on screen after the run. */
  const preview = useCallback((plan: RunPlan): Promise<RunResult> => {
    const mount = previewMount.current;
    if (!mount) return consoleRunner().run(plan);
    previewHost.current ??= previewRunner(mount);
    return previewHost.current.run(plan.mode === 'dom' ? { ...plan, mode: 'preview' } : plan);
  }, []);
  const abort = useCallback(() => {
    consoleRunner().abort();
    previewHost.current?.abort();
  }, []);
  return { previewMount, hidden, preview, abort };
}

const DRAFT_PREFIX = 'proginone:draft:';

/**
 * Code answers are auto-saved per practice item in this browser (ui-ux.md EditorPane "저장됨").
 * Storage can be unavailable (private mode); then drafts are simply not kept.
 */
export function loadDraft(key: string): unknown {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

export function saveDraft(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // ignore
  }
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
