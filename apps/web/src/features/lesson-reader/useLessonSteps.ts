import { useCallback, useEffect, useRef, useState } from 'react';
import { stepIndexOf, type LessonStep } from './steps.ts';

/** How long a "다음 단계" scroll owns the current step before scrolling takes over again. */
const MANUAL_LOCK_MS = 1_000;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * Current step of the step view (D-077).
 *
 * - Scrolling: the last step whose card top passed a line at 35% of the viewport is current
 *   (at the end of the page, the last card on screen).
 * - "다음 단계": `goTo` scrolls to the card (instantly with reduced motion), moves focus to it and
 *   makes it current; scroll updates are ignored while that scroll runs.
 * - Reopening: once the saved position arrives (`resumeSectionId`, the `lastSectionId` of the
 *   reading progress), the reader jumps to its step, unless the URL points somewhere (`#...`) or
 *   the learner already scrolled.
 *
 * Steps are never locked: every card stays readable and clickable.
 */
export function useLessonSteps(
  steps: readonly LessonStep[],
  resumeSectionId: string | null | undefined,
) {
  const [current, setCurrent] = useState(0);
  const lockedUntil = useRef(0);
  const key = steps.map((s) => s.id).join('|');

  useEffect(() => {
    if (steps.length === 0) return;
    const onScroll = () => {
      if (Date.now() < lockedUntil.current) return;
      const tops = steps.map(
        (s) => document.getElementById(s.id)?.getBoundingClientRect().top ?? Infinity,
      );
      // At the end of the page the last cards can never reach the line: take the last one
      // whose top is on screen instead.
      const atEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const line = window.innerHeight * (atEnd ? 0.9 : 0.35);
      let index = 0;
      tops.forEach((top, i) => {
        if (top <= line) index = i;
      });
      setCurrent(index);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures `steps`
  }, [key]);

  const goTo = useCallback(
    (index: number, options: { focus?: boolean; smooth?: boolean } = {}) => {
      const step = steps[index];
      if (!step) return;
      const smooth = (options.smooth ?? true) && !prefersReducedMotion();
      lockedUntil.current = Date.now() + (smooth ? MANUAL_LOCK_MS : 200);
      setCurrent(index);
      const el = document.getElementById(step.id);
      if (!el) return;
      // jsdom has no scrollIntoView.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (el.scrollIntoView)
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      if (options.focus) el.focus({ preventScroll: true });
    },
    [steps],
  );

  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (!resumeSectionId || resumed.current === resumeSectionId) return;
    // After the next paint, so the cards have their final layout.
    const frame = requestAnimationFrame(() => {
      resumed.current = resumeSectionId;
      const i = stepIndexOf(steps, resumeSectionId);
      if (i <= 0 || window.location.hash || window.scrollY > 40) return;
      goTo(i, { smooth: false });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [resumeSectionId, steps, goTo]);

  return { current, goTo };
}
