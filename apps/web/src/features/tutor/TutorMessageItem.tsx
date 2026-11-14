import { Bot } from 'lucide-react';
import { Markdown } from '../practice/Markdown.tsx';
import { selectionLabel } from './selection.ts';
import type { ViewMessage } from './useTutorConversation.ts';

export const WITHHELD_NOTICE =
  '이 답변에는 아직 보여줄 수 없는 정답이 포함되어 숨겼어요. 질문을 조금 바꿔보거나 힌트를 열어보세요.';

function waitingText(m: ViewMessage): string {
  if (m.phase === 'queued') {
    return m.position
      ? `앞선 답변을 기다리는 중이에요 (${m.position}번째)`
      : '앞선 답변을 기다리는 중이에요';
  }
  return '답변을 준비하는 중이에요…';
}

/** TutorMessage (ui-ux.md 학습 특화 컴포넌트): learner and AI tutor messages. */
export function TutorMessageItem({ message: m }: { message: ViewMessage }) {
  if (m.role === 'system_event') {
    return <li className="tutor-msg tutor-msg--system">{m.content}</li>;
  }
  if (m.role === 'learner') {
    return (
      <li className="tutor-msg tutor-msg--learner">
        <p className="tutor-msg__who">나</p>
        <p className="tutor-msg__question">{m.content}</p>
        {m.selection && (
          <p className="tutor-msg__attached">
            {selectionLabel(m.selection)}: <q>{m.selection.text.slice(0, 120)}</q>
            {m.selection.text.length > 120 && '…'}
          </p>
        )}
      </li>
    );
  }
  const streaming = m.status === 'streaming';
  return (
    <li className="tutor-msg tutor-msg--tutor" aria-busy={streaming || undefined}>
      <p className="tutor-msg__who">
        <Bot size={14} aria-hidden="true" />
        AI 튜터
      </p>
      {m.status === 'withheld' ? (
        <p className="tutor-msg__notice">{WITHHELD_NOTICE}</p>
      ) : (
        <>
          {m.content !== '' && (
            <div className="tutor-msg__body">
              <Markdown text={m.content} variant="ai" />
              {streaming && m.phase === 'running' && (
                <span className="tutor-msg__cursor" aria-hidden="true" />
              )}
            </div>
          )}
          {streaming && m.content === '' && (
            <p className="tutor-msg__waiting" aria-hidden="true">
              {waitingText(m)}
            </p>
          )}
        </>
      )}
      {m.status === 'cancelled' && <p className="tutor-msg__meta">(중단됨)</p>}
      {m.status === 'interrupted' && (
        <p className="tutor-msg__meta">(앱이 멈춰 답변이 중간에 끊겼어요)</p>
      )}
      {m.status === 'failed' && (
        <p className="tutor-msg__error">
          답변을 받지 못했어요. {m.error?.message ?? '잠시 후 다시 질문해 주세요.'}
          {m.error && <span className="tutor-msg__code"> ({m.error.code})</span>}
        </p>
      )}
    </li>
  );
}
