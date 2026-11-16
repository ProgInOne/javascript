import type { CodeDraftFile, CodeDraftPut } from '@proginone/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { exerciseDraftQuery, putExampleDraft, putExerciseDraft } from '../../api/queries.ts';
import { saveLocalDraft, type DraftSnapshot, type DraftTarget } from './local.ts';

/**
 * Code drafts (FR-CODE-06, NFR-04; system-architecture.md#상태-관리, D-062). Every edit is saved
 * at once in this browser (localStorage) and sent to the server after 2 seconds without edits,
 * and again when the page is hidden or the editor closes. On reopen the newest of the browser
 * draft and the server draft wins (`updatedAt`, the edit time). A draft written in a practice
 * set item restores only into that item, so a later review of the same exercise starts from the
 * starter code (retrieval practice).
 */

/** Server save after this long without edits (data-model.md#code_drafts). */
export const SERVER_SAVE_DEBOUNCE_MS = 2_000;

export {
  clearAllLocalDrafts,
  clearLegacyDraft,
  clearLocalDraft,
  loadLegacyDraft,
  loadLocalDraft,
  saveLocalDraft,
  type DraftSnapshot,
  type DraftTarget,
} from './local.ts';

/** The newest draft written in this context (`practiceSetItemId`, null outside a set). */
export function pickDraft(
  candidates: readonly (DraftSnapshot | null | undefined)[],
  practiceSetItemId: string | null,
): DraftSnapshot | null {
  let best: DraftSnapshot | null = null;
  for (const c of candidates) {
    if (c?.practiceSetItemId !== practiceSetItemId) continue;
    if (!best || c.updatedAt > best.updatedAt) best = c;
  }
  return best;
}

/** Same files in the same order. */
export function sameFiles(a: readonly CodeDraftFile[], b: readonly CodeDraftFile[]): boolean {
  return (
    a.length === b.length &&
    a.every((f, i) => {
      const g = b[i];
      return f.path === g?.path && f.content === g.content;
    })
  );
}

/**
 * The server draft of a code exercise for the first render. `ready` once it arrived or failed
 * (a failure only means the browser draft or the starter code is used).
 */
export function useServerExerciseDraft(exerciseId: string, enabled: boolean) {
  const query = useQuery({ ...exerciseDraftQuery(exerciseId), enabled });
  return {
    ready: !enabled || query.isSuccess || query.isError,
    draft: query.data?.draft ?? null,
  };
}

function putDraft(target: DraftTarget, body: CodeDraftPut, keepalive: boolean) {
  return target.kind === 'exercise'
    ? putExerciseDraft(target.exerciseId, body, keepalive)
    : putExampleDraft(target.lessonId, target.exampleId, body, keepalive);
}

export type DraftSaveStatus = 'idle' | 'local' | 'saving' | 'saved' | 'unsaved';

/** EditorPane status text (ui-ux.md 상태 문구 "저장 중… / 저장됨"). */
export function draftStatusText(status: DraftSaveStatus): string | undefined {
  switch (status) {
    case 'idle':
      return undefined;
    case 'local':
      return '저장됨 · 이 브라우저';
    case 'saving':
      return '저장 중…';
    case 'saved':
      return '저장됨';
    case 'unsaved':
      return '저장하지 못했어요';
  }
}

/**
 * Saves edits of one target: locally at once, on the server after a 2-second pause, on
 * `pagehide`/hidden tab and when the component unmounts (keepalive, so it survives navigation).
 */
export function useDraftSaver(target: DraftTarget, practiceSetItemId: string | null) {
  const [status, setStatus] = useState<DraftSaveStatus>('idle');
  const pending = useRef<{ snapshot: DraftSnapshot; local: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef({ target, practiceSetItemId });
  useEffect(() => {
    current.current = { target, practiceSetItemId };
  });

  const flush = useCallback((keepalive: boolean) => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const { files, updatedAt, practiceSetItemId: item } = next.snapshot;
    putDraft(
      current.current.target,
      { files, updatedAt, ...(item === null ? {} : { practiceSetItemId: item }) },
      keepalive,
    ).then(
      () => {
        if (pending.current === null) setStatus('saved');
      },
      () => {
        // The browser copy (if any) still holds the edit; the next edit retries the server.
        if (pending.current === null) setStatus(next.local ? 'local' : 'unsaved');
      },
    );
  }, []);

  const save = useCallback(
    (files: CodeDraftFile[]) => {
      const snapshot: DraftSnapshot = {
        files,
        updatedAt: Date.now(),
        practiceSetItemId: current.current.practiceSetItemId,
      };
      const local = saveLocalDraft(current.current.target, snapshot);
      pending.current = { snapshot, local };
      setStatus(local ? 'local' : 'saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        flush(false);
      }, SERVER_SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      flush(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush(true);
    };
  }, [flush]);

  /** Drops an unsent edit (the draft is being deleted). */
  const discard = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    setStatus('idle');
  }, []);

  return { save, discard, status, statusText: draftStatusText(status) };
}
