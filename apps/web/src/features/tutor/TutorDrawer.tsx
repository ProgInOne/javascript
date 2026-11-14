import type { TutorEntryPoint } from '@proginone/shared';
import { Button, EmptyState, ErrorState, IconButton, Skeleton, Spinner } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import { MessageCircle, PlugZap, Send, Square, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { useAiStatus } from '../ai/api.ts';
import { AI_NOT_CONNECTED_COPY, describeAi } from '../ai/status.ts';
import { DRAWER_ATTR, selectionLabel } from './selection.ts';
import { F6_REGION, useTutor, type TutorScope } from './TutorContext.tsx';
import { TutorMessageItem } from './TutorMessageItem.tsx';
import { useTutorConversation } from './useTutorConversation.ts';

export const DRAWER_MIN = 360;
export const DRAWER_MAX = 560;
export const DRAWER_DEFAULT = 400;
const MAX_QUESTION = 4_000;

interface Quick {
  label: string;
  question: string;
  entryPoint: TutorEntryPoint;
}

/** Quick questions change with the context (ui-ux.md 튜터 드로어). */
function quickQuestions(scope: TutorScope): Quick[] {
  if (scope.scopeType === 'lesson') {
    return [
      {
        label: '다른 예시로 설명해 줘요',
        question: '이 단원 내용을 다른 예시로 설명해 줄래요?',
        entryPoint: 'free',
      },
      {
        label: '핵심만 정리해 줘요',
        question: '이 단원의 핵심을 짧게 정리해 줄래요?',
        entryPoint: 'free',
      },
    ];
  }
  const quick: Quick[] = [];
  if (scope.lastIncorrect) {
    quick.push({
      label: '왜 틀렸나요?',
      question: '제 답이 왜 틀렸는지 알려 줄래요?',
      entryPoint: 'mistake_followup',
    });
  }
  quick.push(
    {
      label: '어디서부터 시작할까요?',
      question: '이 문제를 어디서부터 생각하면 될까요?',
      entryPoint: 'free',
    },
    {
      label: '개념 다시 설명',
      question: '이 문제에 필요한 개념을 다시 설명해 줄래요?',
      entryPoint: 'free',
    },
  );
  return quick;
}

/**
 * 튜터 드로어 (docs/design/ui-ux.md#튜터-드로어): a non-modal right panel that pushes the page
 * content. No focus trap; Esc stops a reply or closes it; F6 cycles regions; resizable 360–560px.
 */
export function TutorDrawer({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const tutor = useTutor();
  const titleId = useId();
  const liveId = useId();
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    // Re-render the same text too: alternate a trailing space so it is announced again.
    setAnnouncement((prev) => (prev === text ? `${text} ` : text));
  }, []);
  // Opening the tutor is a lazy-start trigger, like the settings AI section.
  const status = useAiStatus({ connect: true });
  const ai = describeAi(status.data);
  const scope = tutor?.scope ?? null;
  const convo = useTutorConversation(scope, announce);
  const [question, setQuestion] = useState('');
  const [includeCode, setIncludeCode] = useState(true);
  const [includeRun, setIncludeRun] = useState(true);
  const [sendError, setSendError] = useState<ApiRequestError | Error | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  // A new scope (another exercise) starts with its context chips on again.
  const scopeKey = scope ? `${scope.scopeType}:${scope.scopeId}` : '';
  const [chipsFor, setChipsFor] = useState(scopeKey);
  if (chipsFor !== scopeKey) {
    setChipsFor(scopeKey);
    setIncludeCode(true);
    setIncludeRun(true);
    setSendError(null);
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, [tutor?.focusRequest]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && nearBottom.current) list.scrollTop = list.scrollHeight;
  }, [convo.messages]);

  if (!tutor || !scope) return null;
  const selection = tutor.selection;
  const hasCode = scope.hasCode === true;
  const hasRun = scope.hasRun === true;
  const blocked = !ai.usable;

  const submit = async (text: string, entryPoint?: TutorEntryPoint) => {
    const q = text.trim();
    if (!q || convo.streaming || blocked) return;
    setSendError(null);
    const attached = selection;
    setQuestion('');
    tutor.clearSelection();
    const result = await convo.send(q.slice(0, MAX_QUESTION), {
      entryPoint: entryPoint ?? (attached ? 'selection' : 'free'),
      selection: attached,
      includeCode: includeCode && scope.scopeType === 'exercise',
      includeRun: includeRun && scope.scopeType === 'exercise',
    });
    if (!result.ok && result.error.message !== 'busy') {
      // Nothing was stored: give the question (and the selection) back.
      setSendError(result.error);
      setQuestion(q);
      if (attached) tutor.openTutor({ selection: attached });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (convo.streaming) convo.cancel();
    else tutor.closeTutor();
  };

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(question);
    }
  };

  const messages = convo.messages;
  const loading = convo.thread.isPending || (convo.thread.isSuccess && convo.detail.isPending);
  const loadError = convo.thread.error ?? convo.detail.error;

  return (
    <aside
      id={tutor.drawerId}
      className="tutor-drawer"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      {...{ [F6_REGION]: '', [DRAWER_ATTR]: '' }}
    >
      <ResizeHandle width={width} onWidth={onWidth} />
      <header className="tutor-drawer__header">
        <div className="min-w-0">
          <h2 id={titleId} className="tutor-drawer__title">
            AI 튜터
          </h2>
          <p className="tutor-drawer__scope">{scope.title}</p>
        </div>
        <IconButton
          label="튜터 닫기"
          shortcut="Esc"
          icon={<X size={18} />}
          onClick={tutor.closeTutor}
        />
      </header>

      <ul className="tutor-chips" aria-label="튜터에게 함께 보내는 정보">
        <li className="tutor-chip tutor-chip--fixed">
          {scope.scopeType === 'exercise' ? '현재 문제' : '이 단원'}
        </li>
        {scope.scopeType === 'exercise' && hasCode && includeCode && (
          <Chip
            label="내 코드"
            onRemove={() => {
              setIncludeCode(false);
            }}
          />
        )}
        {scope.scopeType === 'exercise' && hasRun && includeRun && (
          <Chip
            label="실행 결과"
            onRemove={() => {
              setIncludeRun(false);
            }}
          />
        )}
        {selection && (
          <Chip
            label={selectionLabel(selection)}
            title={selection.text}
            onRemove={tutor.clearSelection}
          />
        )}
      </ul>

      <div
        ref={listRef}
        className="tutor-drawer__body"
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {loading ? (
          <Skeleton height={120} />
        ) : loadError ? (
          <ErrorState
            variant="inline"
            title="대화를 불러오지 못했어요"
            description={loadError.message}
            action={
              <Button
                size="sm"
                onClick={() => {
                  if (convo.thread.isError) void convo.thread.refetch();
                  else void convo.detail.refetch();
                }}
              >
                다시 시도
              </Button>
            }
          />
        ) : messages.length === 0 ? (
          blocked ? (
            <EmptyState
              icon={PlugZap}
              headingLevel={3}
              title="AI 튜터를 쓸 수 없어요"
              description={
                status.data?.status.state === 'rate_limited'
                  ? `${ai.reason ?? ''} 그동안 힌트와 해설은 계속 볼 수 있어요.`
                  : status.data?.status.state === 'logged_out'
                    ? AI_NOT_CONNECTED_COPY
                    : `${ai.reason ?? ''}. 연결하지 않아도 모든 문제와 해설은 볼 수 있어요.`
              }
              action={
                <Link to="/settings/ai" className="lesson-link">
                  AI 연결 설정
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={MessageCircle}
              headingLevel={3}
              title="무엇이든 물어보세요"
              description={
                scope.scopeType === 'exercise'
                  ? '이 문제에서 막힌 부분을 물어보세요. 정답 코드는 힌트 3단계 이후에 볼 수 있어요.'
                  : '이 단원에서 궁금한 점을 물어보세요. 본문을 선택하고 ⌘J를 눌러도 돼요.'
              }
            />
          )
        ) : (
          <ol className="tutor-messages" aria-label="튜터 대화">
            {messages.map((m) => (
              <TutorMessageItem key={m.id} message={m} />
            ))}
          </ol>
        )}
      </div>

      <form
        className="tutor-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        {blocked && messages.length > 0 && (
          <p className="tutor-composer__blocked">
            {ai.reason}{' '}
            <Link to="/settings/ai" className="lesson-link">
              AI 연결 설정
            </Link>
          </p>
        )}
        {!blocked && !convo.streaming && (
          <div className="tutor-quick" role="group" aria-label="빠른 질문">
            {quickQuestions(scope).map((q) => (
              <button
                key={q.label}
                type="button"
                className="tutor-quick__button"
                onClick={() => void submit(q.question, q.entryPoint)}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        {sendError && (
          <p role="alert" className="tutor-composer__error">
            {sendError instanceof ApiRequestError
              ? sendError.message
              : '질문을 보내지 못했어요. 잠시 후 다시 시도해 주세요.'}
          </p>
        )}
        <label htmlFor={`${titleId}-q`} className="sr-only">
          튜터에게 질문
        </label>
        <textarea
          ref={inputRef}
          id={`${titleId}-q`}
          className="tutor-composer__input"
          placeholder={blocked ? 'AI 연결이 필요해요' : '질문을 입력하세요…'}
          rows={3}
          maxLength={MAX_QUESTION}
          value={question}
          disabled={blocked}
          data-f6-focus=""
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
          onKeyDown={onInputKey}
        />
        <div className="tutor-composer__row">
          {convo.streaming ? (
            <>
              <span className="tutor-composer__status" role="status">
                <Spinner /> {convo.cancelling ? '중단하는 중…' : '응답 중…'}
              </span>
              <Button
                size="sm"
                icon={<Square size={14} aria-hidden="true" />}
                aria-keyshortcuts="Escape"
                onClick={convo.cancel}
                loading={convo.cancelling}
              >
                중단
              </Button>
            </>
          ) : (
            <>
              <span className="tutor-composer__hint">Enter 보내기 · Shift+Enter 줄바꿈</span>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                icon={<Send size={14} aria-hidden="true" />}
                disabled={blocked || question.trim() === ''}
              >
                보내기
              </Button>
            </>
          )}
        </div>
      </form>
      <div id={liveId} className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </aside>
  );
}

function Chip({ label, title, onRemove }: { label: string; title?: string; onRemove: () => void }) {
  return (
    <li className="tutor-chip" title={title}>
      {label}
      <button
        type="button"
        className="tutor-chip__remove"
        aria-label={`${label} 빼기`}
        onClick={onRemove}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </li>
  );
}

/** Drag handle with keyboard resizing (ui-ux.md 패널 리사이즈 규칙: ←→ 10px, Home/End). */
function ResizeHandle({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (w: number) => Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, Math.round(w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="튜터 드로어 폭"
      aria-valuemin={DRAWER_MIN}
      aria-valuemax={DRAWER_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className="tutor-drawer__resize"
      onKeyDown={(e) => {
        const next =
          e.key === 'ArrowLeft'
            ? width + 10
            : e.key === 'ArrowRight'
              ? width - 10
              : e.key === 'Home'
                ? DRAWER_MIN
                : e.key === 'End'
                  ? DRAWER_MAX
                  : null;
        if (next === null) return;
        e.preventDefault();
        onWidth(clamp(next));
      }}
      onDoubleClick={() => {
        onWidth(DRAWER_DEFAULT);
      }}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onWidth(clamp(drag.current.width + (drag.current.x - e.clientX)));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    />
  );
}
