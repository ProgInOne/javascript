import type { MistakeExplanation } from '@proginone/shared';
import { Badge, Button, Tooltip } from '@proginone/ui';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { useAiAvailability } from '../ai/api.ts';
import { Markdown } from '../practice/Markdown.tsx';
import { requestMistakeExplanation } from './api.ts';

const FALLBACK_REASONS: Partial<Record<string, string>> = {
  AI_NOT_CONNECTED: 'AI가 연결되지 않아',
  AI_UNAVAILABLE: 'AI를 쓸 수 없어',
  AI_RATE_LIMITED: 'AI 사용량 한도에 도달해',
  AI_TIMEOUT: 'AI 응답이 늦어',
};

const NEXT_STEPS: Record<NonNullable<MistakeExplanation['nextStep']>, string> = {
  retry: '다시 풀어 보세요.',
  open_hint: '힌트를 하나 열어 보세요.',
  review_concept: '관련 개념을 복습해 보세요.',
  read_section: '레슨의 해당 부분을 다시 읽어 보세요.',
};

export interface AiMistakeExplanationProps {
  /** The graded wrong attempt. */
  attemptId: string;
}

/**
 * "AI에게 왜 틀렸는지 묻기" under the feedback of a wrong attempt (ai-system.md
 * #evaluatorexplainmistake): the deterministic feedback stays first, the AI explanation follows.
 * When AI cannot help, the server answers with the authored misconception text and the reason.
 */
export function AiMistakeExplanation({ attemptId }: AiMistakeExplanationProps) {
  const ai = useAiAvailability();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MistakeExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = result?.attemptId === attemptId ? result : null;

  const ask = async () => {
    if (pending || !ai.usable) return;
    setPending(true);
    setError(null);
    try {
      setResult(await requestMistakeExplanation(attemptId));
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : 'AI 설명을 받지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      setPending(false);
    }
  };

  const button = (
    <Button
      size="sm"
      variant="ghost"
      className="ai-hint__action"
      icon={<Sparkles size={16} aria-hidden="true" />}
      loading={pending}
      aria-disabled={!ai.usable || undefined}
      onClick={() => void ask()}
    >
      AI에게 왜 틀렸는지 묻기
    </Button>
  );

  return (
    <div className="ai-hint">
      {!current &&
        (ai.usable ? (
          button
        ) : (
          <Tooltip content={ai.reason ?? 'AI 연결이 필요해요'}>{button}</Tooltip>
        ))}
      {!current && !ai.usable && (
        <p className="pi-ex-hints__note">{ai.reason ?? 'AI 연결이 필요해요'}</p>
      )}
      <div role="status">
        {pending && <p className="pi-ex-hints__note">답을 살펴보고 있어요…</p>}
        {error && <p className="practice-error">{error}</p>}
        {current &&
          (current.source === 'ai' ? (
            <section className="ai-hint__result" aria-label="AI 오답 분석">
              <p className="ai-hint__title">
                <Badge variant="ai">AI</Badge> {current.summary}
              </p>
              <Markdown text={current.explanationMarkdown} variant="ai" />
              {current.nextStep && (
                <p className="ai-hint__extra">
                  <strong>다음 단계:</strong> {NEXT_STEPS[current.nextStep]}
                </p>
              )}
              {current.misconception && (
                <p className="ai-hint__extra">
                  이 답에서 보인 오개념 후보로 기록했어요: {current.misconception.title}
                </p>
              )}
            </section>
          ) : (
            <section className="ai-hint__fallback" aria-label="작성된 오답 설명">
              <p className="pi-ex-hints__note">
                {(current.fallbackCode && FALLBACK_REASONS[current.fallbackCode]) ??
                  'AI 설명을 만들지 못해'}{' '}
                {current.explanationMarkdown
                  ? '작성된 오개념 설명을 보여 드려요.'
                  : '위의 피드백과 해설을 참고해 주세요.'}
              </p>
              {current.explanationMarkdown && <Markdown text={current.explanationMarkdown} />}
            </section>
          ))}
      </div>
    </div>
  );
}
