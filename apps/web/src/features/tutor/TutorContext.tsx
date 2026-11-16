import type { TutorCodeFiles, TutorRunSummary, TutorSelection } from '@proginone/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isApplePlatform } from '@proginone/exercise-ui';
import { PANEL_KEYS, readPanel, WIDE_QUERY, writePanel } from '../../lib/panels.ts';
import { readTutorSelection } from './selection.ts';

/** What the tutor is about: one thread per lesson or exercise (FR-AI-07). */
export interface TutorScope {
  scopeType: 'lesson' | 'exercise';
  scopeId: string;
  /** Drawer header line, e.g. "첫 프로그램 · 문제 2". */
  title: string;
  lessonId?: string | undefined;
  exerciseId?: string | undefined;
  practiceSetItemId?: string | undefined;
  /** Latest learner code (exercise scope), read when a question is sent. */
  getCode?: (() => TutorCodeFiles | null) | undefined;
  /** Latest run summary (exercise scope), read when a question is sent. */
  getRun?: (() => TutorRunSummary | null) | undefined;
  /** The last graded answer was not correct: offers "왜 틀렸나요?". */
  lastIncorrect?: boolean | undefined;
  /** A code exercise: the learner's code can be attached ("내 코드" chip). */
  hasCode?: boolean | undefined;
  /** The learner ran the code: the run can be attached ("실행 결과" chip). */
  hasRun?: boolean | undefined;
}

interface TutorContextValue {
  open: boolean;
  scope: TutorScope | null;
  /** Selected lesson text or code attached as a context chip. */
  selection: TutorSelection | null;
  clearSelection: () => void;
  openTutor: (options?: { selection?: TutorSelection | null }) => void;
  closeTutor: () => void;
  toggleTutor: () => void;
  /** Increments whenever the drawer should move focus to its question field. */
  focusRequest: number;
  setScope: (id: string, scope: TutorScope) => void;
  removeScope: (id: string) => void;
  drawerId: string;
  /** Callback ref for the header button (focus returns there when nothing else fits). */
  registerTrigger: (el: HTMLButtonElement | null) => void;
  /**
   * 선제 제안 (D-010, ui-ux.md 튜터 드로어): the header button shows a violet dot and "도움이
   * 필요하면 물어보세요" until the learner opens the drawer. Never opens the drawer by itself.
   */
  nudge: boolean;
  suggestHelp: () => void;
}

const TutorContext = createContext<TutorContextValue | null>(null);
const TutorRegistry = createContext<Pick<
  TutorContextValue,
  'setScope' | 'removeScope' | 'suggestHelp'
> | null>(null);

/** The tutor drawer state of a learning screen, or null outside one. */
export function useTutor(): TutorContextValue | null {
  return useContext(TutorContext);
}

const scopeKey = (s: TutorScope) =>
  [
    s.scopeType,
    s.scopeId,
    s.title,
    s.lessonId,
    s.exerciseId,
    s.practiceSetItemId,
    s.lastIncorrect,
    s.hasCode,
    s.hasRun,
  ]
    .map(String)
    .join('|');

/**
 * Registers what the tutor is about while mounted. An exercise scope (current practice item)
 * wins over the lesson scope of the page. Function fields are read when a question is sent.
 */
export function useTutorScope(scope: TutorScope | null) {
  // A separate, stable context: registering never re-renders the item when the drawer changes.
  const registry = useContext(TutorRegistry);
  const id = useId();
  useEffect(() => {
    if (registry && scope) registry.setScope(id, scope);
  });
  useEffect(
    () => () => {
      registry?.removeScope(id);
    },
    [registry, id],
  );
}

/**
 * Marks the tutor button with the proactive suggestion (repeated failure, a confident wrong
 * answer). A no-op outside a learning screen. Callers check `tutor.proactiveSuggestions` first.
 */
export function useSuggestHelp(): () => void {
  const registry = useContext(TutorRegistry);
  return registry?.suggestHelp ?? noop;
}
const noop = () => undefined;

/** Regions cycled with F6 / Shift+F6 (ui-ux.md 포커스 관리: non-modal drawer, no focus trap). */
export const F6_REGION = 'data-f6-region';

const FOCUSABLE =
  'textarea:not([disabled]), input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusRegion(region: Element) {
  const preferred = region.querySelector<HTMLElement>('[data-f6-focus]');
  const target = preferred ?? region.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus();
}

function restoredOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return readPanel(PANEL_KEYS.tutorOpen) === 'true' && window.matchMedia(WIDE_QUERY).matches;
}

/**
 * Tutor drawer state for a learning screen: open/close with return focus, the selection chip,
 * the current scope, `⌘J` (Ctrl+J elsewhere) and F6 region cycling.
 */
export function TutorProvider({ children }: { children: ReactNode }) {
  // The drawer reopens where the learner left it open (FR-UI-01 상태 기억, D-067), but only where
  // it pushes the content aside: below 1280px it would cover the page as an overlay.
  const [open, setOpen] = useState(restoredOpen);
  const [nudge, setNudge] = useState(false);
  const [selection, setSelection] = useState<TutorSelection | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  // Scope identity lives in state; the getters (latest code and run) in a ref read on send.
  const [entries, setEntries] = useState<{ id: string; scope: TutorScope }[]>([]);
  const getters = useRef(new Map<string, Pick<TutorScope, 'getCode' | 'getRun'>>());
  const returnFocus = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const registerTrigger = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el;
  }, []);
  const drawerId = useId();
  const openRef = useRef(open);

  const setScope = useCallback((id: string, scope: TutorScope) => {
    getters.current.set(id, { getCode: scope.getCode, getRun: scope.getRun });
    setEntries((prev) => {
      const index = prev.findIndex((e) => e.id === id);
      const previous = prev[index];
      if (previous && scopeKey(previous.scope) === scopeKey(scope)) return prev;
      const { getCode: _code, getRun: _run, ...plain } = scope;
      const next = {
        id,
        scope: {
          ...plain,
          getCode: () => getters.current.get(id)?.getCode?.() ?? null,
          getRun: () => getters.current.get(id)?.getRun?.() ?? null,
        },
      };
      return index < 0 ? [...prev, next] : prev.map((e, i) => (i === index ? next : e));
    });
  }, []);
  const removeScope = useCallback((id: string) => {
    getters.current.delete(id);
    setEntries((prev) => (prev.some((e) => e.id === id) ? prev.filter((e) => e.id !== id) : prev));
  }, []);

  const scope = useMemo(() => {
    const all = entries.map((e) => e.scope);
    return all.findLast((s) => s.scopeType === 'exercise') ?? all.at(-1) ?? null;
  }, [entries]);

  const openTutor = useCallback((options: { selection?: TutorSelection | null } = {}) => {
    if (!openRef.current) {
      const active = document.activeElement;
      returnFocus.current =
        active instanceof HTMLElement && active !== document.body ? active : null;
    }
    if (options.selection) setSelection(options.selection);
    openRef.current = true;
    setOpen(true);
    writePanel(PANEL_KEYS.tutorOpen, 'true');
    setNudge(false);
    setFocusRequest((n) => n + 1);
  }, []);

  const closeTutor = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    writePanel(PANEL_KEYS.tutorOpen, null);
    // Back to where the learner was, or to the header button (ui-ux.md 포커스 관리).
    const target = returnFocus.current;
    returnFocus.current = null;
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else triggerRef.current?.focus();
    });
  }, []);

  // While the drawer is open the learner already has the tutor at hand.
  const suggestHelp = useCallback(() => {
    if (!openRef.current) setNudge(true);
  }, []);

  const toggleTutor = useCallback(() => {
    if (openRef.current) closeTutor();
    else openTutor();
  }, [closeTutor, openTutor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'F6' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const regions = [...document.querySelectorAll(`[${F6_REGION}]`)];
        if (regions.length < 2) return;
        e.preventDefault();
        const active = document.activeElement;
        const current = regions.findIndex((r) => active && r.contains(active));
        const step = e.shiftKey ? -1 : 1;
        const start = current < 0 ? (e.shiftKey ? 0 : -1) : current;
        const next = regions[(start + step + regions.length) % regions.length];
        if (next) focusRegion(next);
        return;
      }
      const mod = isApplePlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'j') return;
      e.preventDefault();
      // With lesson text or code selected, ⌘J asks about the selection (선택해서 질문하기).
      const picked = readTutorSelection();
      if (picked) openTutor({ selection: picked });
      else toggleTutor();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [openTutor, toggleTutor]);

  const value = useMemo<TutorContextValue>(
    () => ({
      open,
      scope,
      selection,
      clearSelection: () => {
        setSelection(null);
      },
      openTutor,
      closeTutor,
      toggleTutor,
      focusRequest,
      setScope,
      removeScope,
      drawerId,
      registerTrigger,
      nudge,
      suggestHelp,
    }),
    [
      open,
      scope,
      selection,
      openTutor,
      closeTutor,
      toggleTutor,
      focusRequest,
      setScope,
      removeScope,
      drawerId,
      registerTrigger,
      nudge,
      suggestHelp,
    ],
  );
  const registry = useMemo(
    () => ({ setScope, removeScope, suggestHelp }),
    [setScope, removeScope, suggestHelp],
  );
  return (
    <TutorRegistry.Provider value={registry}>
      <TutorContext.Provider value={value}>{children}</TutorContext.Provider>
    </TutorRegistry.Provider>
  );
}
