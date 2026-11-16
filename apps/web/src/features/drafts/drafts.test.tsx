import { SETTINGS_DEFAULTS, type CodeDraft, type PracticeSetView } from '@proginone/shared';
import { act, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import {
  FIX,
  fixView,
  lesson,
  LESSON_ID,
  MCQ,
  mcqView,
  practiceSet,
  SET_ID,
} from '../../test/practice-fixtures.ts';
import {
  clearAllLocalDrafts,
  loadLegacyDraft,
  loadLocalDraft,
  pickDraft,
  saveLocalDraft,
  SERVER_SAVE_DEBOUNCE_MS,
  useDraftSaver,
  type DraftSnapshot,
} from './drafts.ts';

// Code drafts in the browser and on the server (FR-CODE-06, NFR-04, D-063).

const files = (content: string) => [{ path: 'main.js', content }];
const snap = (content: string, updatedAt: number, item: string | null = null): DraftSnapshot => ({
  files: files(content),
  updatedAt,
  practiceSetItemId: item,
});
const target = { kind: 'exercise', exerciseId: FIX } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('draft storage and precedence', () => {
  it('keeps the newest draft written in the same context', () => {
    const older = snap('old', 1, 'ITEM');
    const newer = snap('new', 2, 'ITEM');
    const elsewhere = snap('other item', 3, 'OTHER');
    expect(pickDraft([older, newer, elsewhere], 'ITEM')).toBe(newer);
    expect(pickDraft([newer, older], 'ITEM')).toBe(newer);
    // A review of the same exercise (another item) starts from the starter code.
    expect(pickDraft([older, newer], 'REVIEW')).toBeNull();
    // Projects and examples have no item.
    expect(pickDraft([snap('p', 5), null, undefined], null)?.files[0]?.content).toBe('p');
  });

  it('round-trips browser drafts, ignores junk and clears them all', () => {
    expect(saveLocalDraft(target, snap('mine', 10, 'ITEM'))).toBe(true);
    expect(loadLocalDraft(target)).toEqual(snap('mine', 10, 'ITEM'));
    localStorage.setItem(`proginone:draft:exercise:${MCQ}`, '{not json');
    expect(loadLocalDraft({ kind: 'exercise', exerciseId: MCQ })).toBeNull();
    // A v0.3 draft (raw answer per set item) is read as the oldest draft of that item.
    localStorage.setItem('proginone:draft:S:I', JSON.stringify({ files: files('legacy') }));
    expect(loadLegacyDraft('S:I', 'I')).toEqual(snap('legacy', 0, 'I'));
    localStorage.setItem('other-app', 'kept');

    clearAllLocalDrafts();
    expect(loadLocalDraft(target)).toBeNull();
    expect(loadLegacyDraft('S:I', 'I')).toBeNull();
    expect(localStorage.getItem('other-app')).toBe('kept');
  });
});

describe('useDraftSaver', () => {
  it('saves locally at once and on the server after a 2-second pause', async () => {
    vi.useFakeTimers();
    const puts: { url: string; body: unknown; keepalive: boolean }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { files: unknown; updatedAt: number };
        puts.push({ url, body, keepalive: init.keepalive === true });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              applied: true,
              draft: { kind: 'exercise', id: FIX, practiceSetItemId: 'ITEM', ...body },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );
    const { result, unmount } = renderHook(() => useDraftSaver(target, 'ITEM'));
    expect(result.current.statusText).toBeUndefined();

    act(() => {
      result.current.save(files('a'));
      vi.advanceTimersByTime(1_000);
      result.current.save(files('ab'));
    });
    expect(loadLocalDraft(target)?.files).toEqual(files('ab'));
    expect(result.current.statusText).toBe('저장됨 · 이 브라우저');
    expect(puts).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(SERVER_SAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({
      url: `/api/v1/code-drafts/exercises/${encodeURIComponent(FIX)}`,
      body: { files: files('ab'), practiceSetItemId: 'ITEM' },
      keepalive: false,
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.statusText).toBe('저장됨');

    // Closing the editor sends the unsent edit at once, as a keepalive request.
    act(() => {
      result.current.save(files('abc'));
    });
    unmount();
    expect(puts).toHaveLength(2);
    expect(puts[1]).toMatchObject({ body: { files: files('abc') }, keepalive: true });
  });

  it('keeps the browser copy when the server cannot be reached', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    const { result } = renderHook(() => useDraftSaver(target, null));
    act(() => {
      result.current.save(files('x'));
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.statusText).toBe('저장됨 · 이 브라우저');
    expect(loadLocalDraft(target)?.files).toEqual(files('x'));
  });
});

describe('restoring a practice item', () => {
  const fixItem = practiceSet().items[1];
  const itemId = fixItem?.id ?? '';

  function api(serverDraft: CodeDraft | null, set: PracticeSetView = practiceSet()) {
    return (method: string, path: string) => {
      if (path === '/settings') return { body: SETTINGS_DEFAULTS };
      if (path === `/lessons/${encodeURIComponent(LESSON_ID)}`) return { body: lesson };
      if (path === `/practice-sets/${SET_ID}`) return { body: set };
      if (path.startsWith(`/exercises/${encodeURIComponent(MCQ)}?`)) return { body: mcqView };
      if (path.startsWith(`/exercises/${encodeURIComponent(FIX)}?`)) return { body: fixView };
      if (method === 'GET' && path === `/code-drafts/exercises/${encodeURIComponent(FIX)}`)
        return { body: { draft: serverDraft } };
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
      };
    };
  }
  const serverDraft = (content: string, updatedAt: number, item: string | null): CodeDraft => ({
    kind: 'exercise',
    id: FIX,
    files: files(content),
    updatedAt,
    practiceSetItemId: item,
  });
  const editorText = async () =>
    (await screen.findByRole('textbox', { name: /main\.js/ })).textContent;
  const open = (draft: CodeDraft | null) =>
    renderApp(`/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=2`, api(draft));

  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the server draft written in this item (another browser, a cleared cache)', async () => {
    open(serverDraft('console.log(3500 * 2);', 5, itemId));
    expect(await editorText()).toBe('console.log(3500 * 2);');
  });

  it('prefers the newer browser draft over an older server draft', async () => {
    saveLocalDraft(target, snap('// newer in this browser', 9, itemId));
    open(serverDraft('// older on the server', 5, itemId));
    expect(await editorText()).toBe('// newer in this browser');
  });

  it('starts from the starter code in another item of the same exercise (review)', async () => {
    open(serverDraft('console.log(3500 * 2);', 5, '01JD3Z8Q6V2K9M4T7R1X5W0ZZZ'));
    expect(await editorText()).toBe('console.log("3500 * 2");');
  });

  it('still opens when the server draft cannot be loaded', async () => {
    saveLocalDraft(target, snap('// only here', 3, itemId));
    renderApp(`/learn/${LESSON_ID}?mode=practice&set=${SET_ID}&i=2`, (method, path) =>
      path.startsWith('/code-drafts/')
        ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x', retryable: true } } }
        : api(null)(method, path),
    );
    expect(await editorText()).toBe('// only here');
  });
});
