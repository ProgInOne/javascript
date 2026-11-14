import {
  tutorStreamEventSchemas,
  type PostTutorMessageRequest,
  type TutorEntryPoint,
  type TutorMessage,
  type TutorMessageStatus,
  type TutorSelection,
} from '@proginone/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseStreamEvent, type ApiRequestError } from '../../api/client.ts';
import { completeParagraphsEnd, speakable } from './announce.ts';
import {
  cancelTutorMessage,
  postTutorMessage,
  tutorMessagesQuery,
  tutorThreadQuery,
} from './api.ts';
import type { TutorScope } from './TutorContext.tsx';

/** A message as the drawer shows it: stored ones plus the turn in flight. */
export interface ViewMessage {
  id: string;
  role: TutorMessage['role'];
  content: string;
  status: TutorMessageStatus;
  /** The reply in flight: waiting for the first text, queued behind another turn, or writing. */
  phase?: 'waiting' | 'queued' | 'running' | undefined;
  /** Queue position while `queued`. */
  position?: number | null | undefined;
  /** Why the reply failed (`failed`). */
  error?: { code: string; message: string; retryable: boolean } | undefined;
  /** Selection sent with this question (shown only for the turn in flight). */
  selection?: TutorSelection | null | undefined;
}

interface LiveTurn {
  threadId: string;
  question: string;
  selection: TutorSelection | null;
  learnerId: string | null;
  messageId: string | null;
  phase: 'waiting' | 'queued' | 'running' | 'finished';
  position: number | null;
  text: string;
  status: TutorMessageStatus;
  error: ViewMessage['error'];
  cancelRequested: boolean;
}

export interface SendOptions {
  entryPoint: TutorEntryPoint;
  selection: TutorSelection | null;
  includeCode: boolean;
  includeRun: boolean;
}

export type SendResult = { ok: true } | { ok: false; error: ApiRequestError | Error };

const POLL_MS = 2_000;

/**
 * One tutor thread (lesson or exercise scope): history, sending a question with its context,
 * the SSE reply (`message.created` → `status` → `delta`… → `reset`? → `done` | `error`), and
 * cancelling it. Complete paragraphs of the reply go to `announce`.
 */
export function useTutorConversation(scope: TutorScope | null, announce: (text: string) => void) {
  const client = useQueryClient();
  const thread = useQuery({
    ...tutorThreadQuery(scope?.scopeType ?? 'lesson', scope?.scopeId ?? ''),
    enabled: scope !== null,
  });
  const threadId = thread.data?.id ?? null;
  const detail = useQuery({
    ...tutorMessagesQuery(threadId ?? ''),
    enabled: threadId !== null,
  });

  const [live, setLiveState] = useState<LiveTurn | null>(null);
  const liveRef = useRef<LiveTurn | null>(null);
  const setLive = useCallback((update: (prev: LiveTurn | null) => LiveTurn | null) => {
    liveRef.current = update(liveRef.current);
    setLiveState(liveRef.current);
  }, []);
  const abort = useRef<AbortController | null>(null);
  // Error details are not stored with the message; keep them for this session.
  const [failures, setFailures] = useState<Record<string, NonNullable<ViewMessage['error']>>>({});
  const announced = useRef(0);
  const announceRef = useRef(announce);
  useEffect(() => {
    announceRef.current = announce;
  });

  // A different thread (scope change): stop following the old turn. The server finishes it.
  useEffect(
    () => () => {
      abort.current?.abort();
      abort.current = null;
      liveRef.current = null;
      setLiveState(null);
    },
    [threadId],
  );

  const refreshUntilSettled = useCallback(
    async (id: string, messageId: string | null) => {
      for (let i = 0; i < 30; i++) {
        const fresh = await client.query({ ...tutorMessagesQuery(id), staleTime: 0 });
        const stored = messageId ? fresh.messages.find((m) => m.id === messageId) : undefined;
        if (stored?.status !== 'streaming') return;
        // The connection dropped mid-reply; the server keeps the turn going (ai-system.md).
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
    [client],
  );

  const speakNew = useCallback((text: string, final: boolean) => {
    const end = final ? text.length : completeParagraphsEnd(text);
    if (end <= announced.current) return;
    const words = speakable(text.slice(announced.current, end));
    announced.current = end;
    if (words) announceRef.current(words);
  }, []);

  const send = useCallback(
    async (question: string, options: SendOptions): Promise<SendResult> => {
      if (!scope || !threadId || (liveRef.current && liveRef.current.phase !== 'finished')) {
        return { ok: false, error: new Error('busy') };
      }
      const currentCode = options.includeCode ? scope.getCode?.() : null;
      const lastRunResult = options.includeRun ? scope.getRun?.() : null;
      const body: PostTutorMessageRequest = {
        question,
        entryPoint: options.entryPoint,
        ...(options.selection ? { selection: options.selection } : {}),
        ...(scope.lessonId ? { lessonId: scope.lessonId } : {}),
        ...(scope.exerciseId ? { exerciseId: scope.exerciseId } : {}),
        ...(scope.practiceSetItemId ? { practiceSetItemId: scope.practiceSetItemId } : {}),
        ...(currentCode ? { currentCode } : {}),
        ...(lastRunResult ? { lastRunResult } : {}),
      };
      const controller = new AbortController();
      abort.current?.abort();
      abort.current = controller;
      announced.current = 0;
      setLive(() => ({
        threadId,
        question,
        selection: options.selection,
        learnerId: null,
        messageId: null,
        phase: 'waiting',
        position: null,
        text: '',
        status: 'streaming',
        error: undefined,
        cancelRequested: false,
      }));
      const update = (patch: Partial<LiveTurn>) => {
        setLive((prev) => (prev?.threadId === threadId ? { ...prev, ...patch } : prev));
      };

      try {
        await postTutorMessage(threadId, body, {
          signal: controller.signal,
          onEvent: (raw) => {
            const event = parseStreamEvent(tutorStreamEventSchemas, raw);
            const current = liveRef.current;
            if (!event || !current) return;
            if (event.name !== 'message.created' && event.data.messageId !== current.messageId) {
              return; // another turn's event
            }
            switch (event.name) {
              case 'message.created':
                update({ learnerId: event.data.learnerMessageId, messageId: event.data.messageId });
                if (current.cancelRequested)
                  void cancelTutorMessage(threadId, event.data.messageId);
                break;
              case 'status':
                update({ phase: event.data.state, position: event.data.position });
                break;
              case 'delta': {
                const text = current.text + event.data.text;
                update({ phase: 'running', text });
                speakNew(text, false);
                break;
              }
              case 'reset':
                announced.current = 0;
                update({ text: '' });
                announceRef.current('답변을 다시 쓰고 있어요.');
                break;
              case 'done':
                update({
                  phase: 'finished',
                  text: event.data.content,
                  status: event.data.status,
                });
                if (event.data.status === 'complete') speakNew(event.data.content, true);
                else if (event.data.status === 'cancelled')
                  announceRef.current('답변을 중단했어요.');
                else announceRef.current('답변을 숨겼어요. 질문을 바꾸거나 힌트를 열어 보세요.');
                break;
              case 'error': {
                const error = {
                  code: event.data.code,
                  message: event.data.message,
                  retryable: event.data.retryable,
                };
                update({ phase: 'finished', status: 'failed', error });
                setFailures((f) => ({ ...f, [event.data.messageId]: error }));
                announceRef.current(`답변을 받지 못했어요. ${event.data.message}`);
                break;
              }
            }
          },
        });
      } catch (e) {
        if (controller.signal.aborted) return { ok: true };
        const created = liveRef.current?.messageId ?? null;
        if (!created) {
          // Refused before streaming (AI not connected, assessment lock…): nothing was stored.
          setLive(() => null);
          return {
            ok: false,
            error: e instanceof Error ? e : new Error(String(e)),
          };
        }
        // The stream broke after the messages were stored: follow the stored state instead.
      } finally {
        if (abort.current === controller) abort.current = null;
      }
      const turn = liveRef.current;
      if (turn?.threadId === threadId) {
        await refreshUntilSettled(threadId, turn.messageId);
        setLive((prev) => (prev?.messageId === turn.messageId ? null : prev));
      }
      return { ok: true };
    },
    [scope, threadId, setLive, speakNew, refreshUntilSettled],
  );

  const cancel = useCallback(() => {
    const turn = liveRef.current;
    if (!threadId || !turn || turn.phase === 'finished') return;
    setLive((prev) => (prev ? { ...prev, cancelRequested: true } : prev));
    if (turn.messageId) {
      cancelTutorMessage(threadId, turn.messageId).catch(() => undefined);
    }
  }, [threadId, setLive]);

  const messages = useMemo<ViewMessage[]>(() => {
    const stored = detail.data?.messages ?? [];
    const withFailures = stored.map((m) =>
      failures[m.id] ? { ...m, error: failures[m.id] } : (m as ViewMessage),
    );
    if (live?.threadId !== threadId) return withFailures;
    const liveIds = new Set([live.learnerId, live.messageId].filter(Boolean));
    const out: ViewMessage[] = withFailures.filter((m) => !liveIds.has(m.id));
    out.push({
      id: live.learnerId ?? 'pending-question',
      role: 'learner',
      content: live.question,
      status: 'complete',
      selection: live.selection,
    });
    out.push({
      id: live.messageId ?? 'pending-reply',
      role: 'tutor',
      content: live.text,
      status: live.status,
      phase: live.phase === 'finished' ? undefined : live.phase,
      position: live.position,
      error: live.error,
    });
    return out;
  }, [detail.data, live, threadId, failures]);

  return {
    thread,
    detail,
    messages,
    streaming: live !== null && live.phase !== 'finished',
    cancelling: live !== null && live.phase !== 'finished' && live.cancelRequested,
    send,
    cancel,
  };
}
