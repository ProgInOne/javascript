import { useEffect, useRef } from 'react';

/** Exercise shortcut handlers (docs/design/ui-ux.md#단축키, "문제" scope). */
export interface ExerciseShortcutHandlers {
  /** `⌘Enter` / `Ctrl+Enter`: submit with confidence "확실해요". */
  onSubmit?: () => void;
  /** `⌘'` / `Ctrl+'`: run without grading. */
  onRun?: () => void;
  /** `⌘.` / `Ctrl+.`: open the next hint. */
  onNextHint?: () => void;
}

export type ExerciseShortcut = keyof ExerciseShortcutHandlers;

/** True on Apple platforms, where the modifier is ⌘ instead of Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

/** Display label of the primary modifier: `⌘` on macOS, `Ctrl` elsewhere. */
export function modKeyLabel(): string {
  return isApplePlatform() ? '⌘' : 'Ctrl';
}

/** `aria-keyshortcuts` value for a modifier shortcut, e.g. `Meta+Enter` or `Control+Enter`. */
export function ariaShortcut(key: string): string {
  return `${isApplePlatform() ? 'Meta' : 'Control'}+${key}`;
}

/**
 * Maps a keydown event to an exercise shortcut. Uses ⌘ on Apple platforms and Ctrl elsewhere;
 * other modifiers must be off so editor and browser shortcuts keep working.
 */
export function matchExerciseShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  apple = isApplePlatform(),
): ExerciseShortcut | null {
  const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey || event.shiftKey) return null;
  switch (event.key) {
    case 'Enter':
      return 'onSubmit';
    case "'":
      return 'onRun';
    case '.':
      return 'onNextHint';
    default:
      return null;
  }
}

/**
 * Registers the exercise shortcuts on `window` while mounted. They carry a modifier, so they also
 * work while the code editor or a text field has focus (the editor leaves these keys unbound).
 * Handlers may change every render; the latest ones are used.
 */
export function useExerciseShortcuts(handlers: ExerciseShortcutHandlers, enabled = true): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const shortcut = matchExerciseShortcut(event);
      if (shortcut === null) return;
      const handler = latest.current[shortcut];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
