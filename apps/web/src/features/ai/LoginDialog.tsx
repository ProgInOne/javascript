import type { AILoginEvent, AIStatusResponse } from '@proginone/shared';
import { Button, Dialog, Spinner, useToast } from '@proginone/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { aiStatusKey, onAiLogin, startAiLogin, useAiCancelLogin } from './api.ts';

export type LoginState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; loginId: string; authUrl: string; tabOpened: boolean }
  | { phase: 'failed'; message: string };

/** Only web URLs are opened or linked (the URL comes from the provider: untrusted). */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * The ChatGPT login (docs/design/ai-system.md#인증-ux-흐름): `POST /ai/login`, open `authUrl` in
 * a new tab, then wait for the `login` event of `/ai/events`. The tab is opened synchronously in
 * the click (popup blockers) and pointed at the URL once the server answers.
 */
export function useAiLogin() {
  const client = useQueryClient();
  const toast = useToast();
  const cancel = useAiCancelLogin();
  const [state, setState] = useState<LoginState>({ phase: 'idle' });
  const tab = useRef<Window | null>(null);
  // Login events can arrive before `POST /ai/login` returns (the mock completes in 10ms).
  const early = useRef<AILoginEvent[]>([]);
  const stateRef = useRef<LoginState>(state);
  const update = useCallback((next: LoginState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const finish = useCallback(
    (event: AILoginEvent) => {
      if (event.success) {
        update({ phase: 'idle' });
        toast({ title: 'AI 튜터를 연결했어요', variant: 'success' });
      } else {
        update({
          phase: 'failed',
          message: event.error ?? '로그인을 마치지 못했어요. 다시 시도해 주세요.',
        });
      }
    },
    [toast, update],
  );

  useEffect(
    () =>
      onAiLogin((event) => {
        const current = stateRef.current;
        if (current.phase === 'starting') early.current.push(event);
        else if (
          current.phase === 'waiting' &&
          (event.loginId === null || event.loginId === current.loginId)
        )
          finish(event);
      }),
    [finish],
  );

  // A status snapshot showing the account connected also ends the wait (missed event).
  useEffect(
    () =>
      client.getQueryCache().subscribe((e) => {
        if (
          stateRef.current.phase !== 'waiting' ||
          (e.query.queryKey as readonly unknown[])[1] !== aiStatusKey[1]
        )
          return;
        const data = e.query.state.data as AIStatusResponse | undefined;
        if (data?.status.state === 'ready' && !data.pendingLogin) {
          finish({ loginId: null, success: true, error: null });
        }
      }),
    [client, finish],
  );

  const start = async () => {
    if (state.phase === 'starting' || state.phase === 'waiting') return;
    early.current = [];
    const opened = window.open('about:blank', '_blank');
    if (opened) opened.opener = null;
    tab.current = opened;
    update({ phase: 'starting' });
    try {
      const res = await startAiLogin();
      const url = safeUrl(res.authUrl);
      if (!url) throw new Error('로그인 주소가 올바르지 않아요.');
      if (opened && !opened.closed) opened.location.href = url;
      const done = early.current.find((e) => e.loginId === null || e.loginId === res.loginId);
      if (done) {
        finish(done);
        return;
      }
      update({
        phase: 'waiting',
        loginId: res.loginId,
        authUrl: url,
        tabOpened: opened !== null,
      });
    } catch (e) {
      opened?.close();
      update({
        phase: 'failed',
        message:
          e instanceof ApiRequestError || e instanceof Error
            ? e.message
            : '로그인을 시작하지 못했어요.',
      });
    }
  };

  const abort = () => {
    if (state.phase === 'waiting') {
      cancel.mutate({ loginId: state.loginId });
      tab.current?.close();
    }
    tab.current = null;
    update({ phase: 'idle' });
  };

  return { state, start, abort };
}

export type AiLogin = ReturnType<typeof useAiLogin>;

/** "브라우저에서 로그인을 마쳐 주세요" + progress + 취소 (ui-ux.md 설정 "로그인 대화상자"). */
export function LoginDialog({ login }: { login: AiLogin }) {
  const { state } = login;
  const open = state.phase === 'waiting' || state.phase === 'failed';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) login.abort();
      }}
      title="ChatGPT 로그인"
      description={state.phase === 'failed' ? undefined : '브라우저에서 로그인을 마쳐 주세요.'}
      closeLabel="로그인 취소"
      footer={
        state.phase === 'failed' ? (
          <>
            <Button onClick={login.abort}>닫기</Button>
            <Button variant="primary" onClick={() => void login.start()}>
              다시 시도
            </Button>
          </>
        ) : (
          <Button onClick={login.abort}>취소</Button>
        )
      }
    >
      {state.phase === 'waiting' && (
        <div className="ai-login">
          <p className="ai-login__progress" role="status">
            <Spinner /> 로그인 완료를 기다리고 있어요…
          </p>
          <p className="ai-settings__note">
            {state.tabOpened
              ? '새 탭이 보이지 않으면 아래 링크로 열어 주세요.'
              : '새 탭을 열지 못했어요. 아래 링크로 로그인 페이지를 열어 주세요.'}
          </p>
          <a
            href={state.authUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="lesson-link inline-flex items-center gap-1"
          >
            로그인 페이지 열기
            <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only">(새 탭)</span>
          </a>
          <p className="ai-settings__note">
            비밀번호는 ChatGPT 페이지에만 입력해요. 앱은 자격 증명을 저장하지 않아요.
          </p>
        </div>
      )}
      {state.phase === 'failed' && (
        <p role="alert" className="practice-error">
          로그인하지 못했어요. {state.message}
        </p>
      )}
    </Dialog>
  );
}
