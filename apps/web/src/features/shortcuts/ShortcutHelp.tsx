import { isApplePlatform } from '@proginone/exercise-ui';
import { Dialog } from '@proginone/ui';
import { useEffect, useId, useState } from 'react';

// 단축키 도움말 (ui-ux.md 키보드 조작, FR-UI-02, D-067): `?` outside text fields, or the keyboard
// button in the learning header, opens a list of the shortcuts the app actually has.

const OPEN_EVENT = 'proginone:shortcut-help';

/** Opens the shortcut help dialog from anywhere (the learning header button). */
export function openShortcutHelp(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Shortcut {
  /** Key groups; `mod` is replaced with ⌘ or Ctrl. Alternatives are separate entries. */
  keys: readonly (readonly string[])[];
  action: string;
}

interface ShortcutGroup {
  title: string;
  items: readonly Shortcut[];
}

/** Only shortcuts that exist. Planned ones (⌘K, `G` 다음 `D`, `[`) are listed once they work. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: '전역',
    items: [
      { keys: [['?']], action: '단축키 도움말 (입력 중이 아닐 때)' },
      { keys: [['F6'], ['⇧', 'F6']], action: '학습 화면의 영역(헤더·본문·튜터) 사이 이동' },
    ],
  },
  {
    title: '학습 화면',
    items: [
      {
        keys: [
          ['mod', '1'],
          ['mod', '2'],
        ],
        action: '읽기 모드 / 실습 모드',
      },
      { keys: [['mod', 'J']], action: '튜터 열기·닫기 (본문을 선택했으면 그 부분을 질문)' },
      { keys: [['mod', 'Enter']], action: '레슨 예제 실행 (예제 안에 포커스가 있을 때)' },
    ],
  },
  {
    title: '문제',
    items: [
      { keys: [['mod', 'Enter']], action: '제출 (확신도 "확실해요")' },
      { keys: [['mod', "'"]], action: '코드 실행 (채점 없이)' },
      { keys: [['mod', '.']], action: '다음 힌트' },
      { keys: [['1~5']], action: '객관식·참거짓 선택지 고르기' },
      {
        keys: [['Enter'], ['Delete'], ['Alt', '↑'], ['Alt', '↓']],
        action: '파슨스: 조각 추가 / 되돌리기 / 줄 옮기기',
      },
    ],
  },
  {
    title: '코드 에디터',
    items: [
      { keys: [['⇧', '⌥', 'F']], action: '코드 정리 (포맷)' },
      { keys: [['Esc'], ['Tab']], action: 'Esc 다음 Tab으로 에디터 밖으로 이동' },
    ],
  },
  {
    title: '튜터',
    items: [
      { keys: [['Enter'], ['⇧', 'Enter']], action: '보내기 / 줄바꿈' },
      { keys: [['Esc']], action: '응답 중단(답하는 중) 또는 드로어 닫기' },
    ],
  },
  {
    title: '패널 크기 조절 핸들',
    items: [
      { keys: [['←'], ['→'], ['↑'], ['↓']], action: '10px씩 넓히기·좁히기' },
      { keys: [['Home'], ['End']], action: '최소 / 최대 크기' },
    ],
  },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('.cm-editor')) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function KeyCombo({ keys }: { keys: readonly string[] }) {
  const mod = isApplePlatform() ? '⌘' : 'Ctrl';
  return (
    <span className="shortcut-help__combo">
      {keys.map((k) => (
        <kbd key={k}>{k === 'mod' ? mod : k}</kbd>
      ))}
    </span>
  );
}

/** Mounted once at the root: `?` and {@link openShortcutHelp} open the dialog. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.key !== '?') return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="단축키"
      description="macOS는 ⌘, Windows·Linux는 Ctrl을 써요. ⌘·Ctrl이 들어간 단축키는 코드 에디터 안에서도 동작해요."
    >
      <div className="shortcut-help">
        {SHORTCUT_GROUPS.map((group, gi) => (
          <section key={group.title} aria-labelledby={`${baseId}-${String(gi)}`}>
            <h3 id={`${baseId}-${String(gi)}`} className="shortcut-help__title">
              {group.title}
            </h3>
            <dl className="shortcut-help__list">
              {group.items.map((item) => (
                <div key={item.action} className="shortcut-help__row">
                  <dt>
                    {item.keys.map((combo, i) => (
                      <KeyCombo key={i} keys={combo} />
                    ))}
                  </dt>
                  <dd>{item.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
