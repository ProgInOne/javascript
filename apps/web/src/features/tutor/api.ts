import {
  aiHintResponseSchema,
  mistakeExplanationSchema,
  cancelTutorMessageResponseSchema,
  tutorThreadDetailSchema,
  tutorThreadSchema,
  type AIHintRequest,
  type PostTutorMessageRequest,
  type TutorScopeType,
} from '@proginone/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, stream, type StreamOptions } from '../../api/client.ts';

// Tutor API (docs/design/system-architecture.md#api-규약 "튜터", packages/shared/src/tutor.ts).

/**
 * The open thread of a lesson or exercise. `POST /tutor/threads` returns the existing open thread
 * of the same scope, so it is safe to use as a query (one conversation per scope).
 */
export const tutorThreadQuery = (scopeType: TutorScopeType, scopeId: string) =>
  queryOptions({
    queryKey: ['tutor', 'thread', scopeType, scopeId],
    queryFn: ({ signal }) =>
      api('/tutor/threads', {
        method: 'POST',
        body: { scopeType, scopeId },
        schema: tutorThreadSchema,
        signal,
      }),
    staleTime: Infinity,
  });

/** The whole conversation, oldest first (D-014). */
export const tutorMessagesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['tutor', 'messages', threadId],
    queryFn: ({ signal }) =>
      api(`/tutor/threads/${encodeURIComponent(threadId)}/messages`, {
        schema: tutorThreadDetailSchema,
        signal,
      }),
    staleTime: Infinity,
  });

/** `POST /tutor/threads/:id/messages`: the reply streams back as SSE. */
export const postTutorMessage = (
  threadId: string,
  body: PostTutorMessageRequest,
  options: Pick<StreamOptions, 'signal' | 'onEvent'>,
) =>
  stream(`/tutor/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body,
    ...options,
  });

export const cancelTutorMessage = (threadId: string, messageId: string) =>
  api(
    `/tutor/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/cancel`,
    { method: 'POST', body: {}, schema: cancelTutorMessageResponseSchema },
  );

/** `POST /exercises/:id/ai-hint`: the hint level already opened, re-explained for this learner. */
export const requestAiHint = (exerciseId: string, body: AIHintRequest) =>
  api(`/exercises/${encodeURIComponent(exerciseId)}/ai-hint`, {
    method: 'POST',
    body,
    schema: aiHintResponseSchema,
  });

/** `POST /attempts/:id/explanation`: why a graded wrong attempt went wrong (evaluator.explainMistake). */
export const requestMistakeExplanation = (attemptId: string) =>
  api(`/attempts/${encodeURIComponent(attemptId)}/explanation`, {
    method: 'POST',
    body: {},
    schema: mistakeExplanationSchema,
  });
