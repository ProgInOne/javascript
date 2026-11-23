import { ariaShortcut, Kbd, modKeyLabel } from '@proginone/exercise-kit-ui';
import { Button, Tooltip } from '@proginone/ui';
import { MessageCircle, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useAiAvailability } from '../ai/api.ts';
import { readTutorSelection } from './selection.ts';
import { F6_REGION, useTutor } from './TutorContext.tsx';
import { DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, TutorDrawer } from './TutorDrawer.tsx';

const WIDTH_KEY = 'proginone:tutor-width';

function initialWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (saved >= DRAWER_MIN && saved <= DRAWER_MAX) return saved;
  } catch {
    // storage unavailable
  }
  return typeof window !== 'undefined' && window.innerWidth >= 1920 ? 480 : DRAWER_DEFAULT;
}

/**
 * Page body + tutor drawer. The drawer pushes the content (not an overlay) from 1280px up and
 * overlays it below (ui-ux.md 반응형과 패널 규칙). `top` is the sticky header height above.
 */
export function TutorLayout({ children, top }: { children: ReactNode; top: number }) {
  const tutor = useTutor();
  const [width, setWidth] = useState(initialWidth);
  const onWidth = useCallback((w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // not kept
    }
  }, []);
  const style = { '--tutor-w': `${width}px`, '--tutor-top': `${top}px` } as CSSProperties;
  return (
    <div className="tutor-layout" style={style} data-open={tutor?.open ? true : undefined}>
      <div className="tutor-layout__main" {...{ [F6_REGION]: '' }}>
        {children}
      </div>
      {tutor?.open && <TutorDrawer width={width} onWidth={onWidth} />}
      <SelectionAsk />
    </div>
  );
}

/** Proactive suggestion copy (ui-ux.md 튜터 드로어 "선제 제안"). */
export const NUDGE_TEXT = '도움이 필요하면 물어보세요';

/** "⌘J 튜터" in the learning header. Always usable: the drawer explains when AI is not. */
export function TutorButton() {
  const tutor = useTutor();
  if (!tutor) return null;
  const { registerTrigger, open, drawerId, toggleTutor, nudge } = tutor;
  const button = (
    <Button
      ref={registerTrigger}
      className="tutor-trigger"
      size="sm"
      variant="ghost"
      icon={<MessageCircle size={16} aria-hidden="true" />}
      aria-expanded={open}
      aria-controls={open ? drawerId : undefined}
      aria-keyshortcuts={ariaShortcut('J')}
      data-nudge={nudge ? true : undefined}
      onClick={toggleTutor}
    >
      튜터
      {nudge && (
        <>
          <span className="tutor-trigger__dot" aria-hidden="true" />
          <span className="sr-only">: {NUDGE_TEXT}</span>
        </>
      )}
      <Kbd keys={[modKeyLabel(), 'J']} />
    </Button>
  );
  // The tooltip only repeats the screen-reader text, so it never carries information alone.
  return nudge ? <Tooltip content={NUDGE_TEXT}>{button}</Tooltip> : button;
}

interface Anchor {
  top: number;
  left: number;
}

/**
 * 선택해서 질문하기: selecting lesson text or code shows "튜터에게 질문 (⌘J)" next to the
 * selection. It never takes focus (keyboard users press ⌘J with the selection instead).
 */
function SelectionAsk() {
  const tutor = useTutor();
  const ai = useAiAvailability();
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!readTutorSelection(selection) || !selection) {
          setAnchor(null);
          return;
        }
        const range = selection.getRangeAt(0);
        const rect =
          typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : { top: 0, bottom: 0, left: 0, width: 0 };
        const below = rect.bottom + 44 < window.innerHeight;
        setAnchor({
          top: below ? rect.bottom + 8 : Math.max(8, rect.top - 44),
          left: Math.min(Math.max(8, rect.left + rect.width / 2 - 90), window.innerWidth - 200),
        });
      });
    };
    document.addEventListener('selectionchange', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, []);

  if (!tutor || !anchor) return null;
  const button = (
    <button
      type="button"
      className="tutor-ask"
      style={{ top: anchor.top, left: anchor.left }}
      aria-disabled={!ai.usable || undefined}
      aria-keyshortcuts={ariaShortcut('J')}
      // Keep the selection: a mousedown would collapse it before the click.
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={() => {
        if (!ai.usable) return;
        const picked = readTutorSelection();
        if (picked) tutor.openTutor({ selection: picked });
        setAnchor(null);
      }}
    >
      <Sparkles size={14} aria-hidden="true" />
      튜터에게 질문
      <Kbd keys={[modKeyLabel(), 'J']} />
    </button>
  );
  return ai.usable ? (
    button
  ) : (
    <Tooltip content={ai.reason ?? 'AI 연결이 필요해요'}>{button}</Tooltip>
  );
}
