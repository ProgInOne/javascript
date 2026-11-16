import {
  aiLoginEventSchema,
  aiLoginResponseSchema,
  aiModelsResponseSchema,
  aiStatusResponseSchema,
  type AILoginEvent,
  type AIStatusResponse,
} from '@proginone/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { api, ApiRequestError, parseStreamEvent, stream } from '../../api/client.ts';
import { describeAi } from './status.ts';

// AI connection state (docs/design/ai-system.md#인증-ux-흐름). One cache entry holds the latest
// `AIStatusResponse`; it is filled by the `/ai/events` stream (which never starts the provider)
// and refreshed by `GET /ai/status` where opening a screen is meant to start it lazily.

export const aiStatusKey = ['ai', 'status'] as const;

/**
 * The AI status. `connect: true` (settings AI section, tutor drawer) asks `GET /ai/status`, which
 * starts Codex on first use; elsewhere only the event stream's snapshots are read.
 */
export function useAiStatus({ connect = false }: { connect?: boolean } = {}) {
  return useQuery({
    queryKey: aiStatusKey,
    queryFn: ({ signal }) => api('/ai/status', { schema: aiStatusResponseSchema, signal }),
    enabled: connect,
    staleTime: Infinity,
    refetchOnMount: connect ? 'always' : false,
  });
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * `navigator.onLine`, kept current (D-068). Only `false` is trusted: it means no network at all,
 * which AI needs. `true` does not prove the provider is reachable; its own errors say that.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** What the current AI state means for AI entry points (tutor, AI hint). */
export function useAiAvailability() {
  const { data } = useAiStatus();
  const online = useOnline();
  return describeAi(data, new Date(), online);
}

export function useAiModels(enabled: boolean) {
  return useQuery({
    queryKey: ['ai', 'models'],
    queryFn: ({ signal }) => api('/ai/models', { schema: aiModelsResponseSchema, signal }),
    enabled,
    staleTime: Infinity,
  });
}

function useStatusMutation(path: string, body?: unknown) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (override?: unknown) =>
      api(path, {
        method: 'POST',
        body: override ?? body ?? {},
        schema: aiStatusResponseSchema,
      }),
    onSuccess: (status) => {
      client.setQueryData(aiStatusKey, status);
    },
  });
}

export const useAiLogout = () => useStatusMutation('/ai/logout');
export const useAiReconnect = () => useStatusMutation('/ai/reconnect');
export const useAiCancelLogin = () => useStatusMutation('/ai/login/cancel');

export const startAiLogin = () =>
  api('/ai/login', { method: 'POST', body: {}, schema: aiLoginResponseSchema });

// ── /ai/events ──

const loginListeners = new Set<(event: AILoginEvent) => void>();

/** Login completions from `/ai/events` (the login dialog waits for its `loginId`). */
export function onAiLogin(listener: (event: AILoginEvent) => void): () => void {
  loginListeners.add(listener);
  return () => {
    loginListeners.delete(listener);
  };
}

const AI_EVENTS = { status: aiStatusResponseSchema, login: aiLoginEventSchema };
const RETRY_MS = [1_000, 2_000, 5_000, 15_000, 30_000];

/**
 * Keeps `aiStatusKey` current from `GET /ai/events` for the app's lifetime. The stream reconnects
 * with backoff after network errors or a server restart, and stops on a non-retryable refusal.
 */
export function subscribeAiEvents(client: QueryClient): () => void {
  const controller = new AbortController();
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    stream('/ai/events', {
      signal: controller.signal,
      onEvent: (raw) => {
        const event = parseStreamEvent(AI_EVENTS, raw);
        if (!event) return;
        failures = 0;
        if (event.name === 'status') {
          const previous = client.getQueryData<AIStatusResponse>(aiStatusKey);
          client.setQueryData(aiStatusKey, event.data);
          if (
            event.data.status.state === 'ready' &&
            previous &&
            previous.status.state !== 'ready'
          ) {
            void client.invalidateQueries({ queryKey: ['ai', 'models'] });
          }
        } else {
          for (const listener of loginListeners) listener(event.data);
        }
      },
    })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return 'stop';
        if (e instanceof ApiRequestError && !e.retryable) return 'stop';
        return 'retry';
      })
      .then((next) => {
        if (controller.signal.aborted || next === 'stop') return;
        const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)] ?? 30_000;
        failures++;
        timer = setTimeout(connect, delay);
      })
      .catch(() => undefined);
  };
  connect();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}

/** Mount once at the root: the shared AI status stream. */
export function AiEventsSync() {
  const client = useQueryClient();
  useEffect(() => subscribeAiEvents(client), [client]);
  return null;
}
