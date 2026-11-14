import type { LessonProgress, LessonProgressRequest } from '@proginone/shared';
import { useEffect, useRef, useState } from 'react';

const SAVE_DELAY_MS = 2_000;

/** 0–1 scroll progress of the page (the body is the page in reading mode). */
function scrollProgress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 1;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

/**
 * Reading progress (`POST /lessons/:id/progress`): the first call on opening the lesson starts it
 * (its concepts become "입문") and returns where the learner stopped last time; later calls save
 * the furthest scroll progress and the current section, debounced.
 */
export function useReadingProgress(
  lessonId: string,
  activeSection: string | null,
  record: (lessonId: string, request: LessonProgressRequest) => Promise<LessonProgress>,
) {
  const [initial, setInitial] = useState<LessonProgress | null>(null);
  const latest = useRef(record);
  useEffect(() => {
    latest.current = record;
  });
  const furthest = useRef(0);
  const started = useRef<string | null>(null);
  // Nothing is saved until the learner scrolls, so opening the lesson keeps the old position.
  const scrolled = useRef(false);
  const section = useRef(activeSection);
  useEffect(() => {
    section.current = activeSection;
  });

  useEffect(() => {
    if (started.current === lessonId) return; // StrictMode double effect
    started.current = lessonId;
    furthest.current = 0;
    scrolled.current = false;
    latest
      .current(lessonId, { readProgress: 0 })
      .then(setInitial)
      .catch(() => undefined);
  }, [lessonId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        furthest.current = Math.max(furthest.current, scrollProgress());
        latest
          .current(lessonId, {
            readProgress: Math.round(furthest.current * 1000) / 1000,
            ...(section.current ? { lastSectionId: section.current } : {}),
          })
          .catch(() => undefined);
      }, SAVE_DELAY_MS);
    };
    const onScroll = () => {
      const first = !scrolled.current;
      scrolled.current = true;
      if (first || scrollProgress() > furthest.current + 0.05) save();
    };
    if (activeSection && scrolled.current) save();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [lessonId, activeSection]);

  return initial;
}
