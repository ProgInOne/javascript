import type { AIHintRequest, AIHintResponse } from '@proginone/shared';
import { Badge, Button, Tooltip } from '@proginone/ui';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { useAiAvailability } from '../ai/api.ts';
import { Markdown } from '../practice/Markdown.tsx';
import { requestAiHint } from './api.ts';

const FALLBACK_REASONS: Partial<Record<string, string>> = {
  AI_NOT_CONNECTED: 'AI가 연결되지 않아',
  AI_UNAVAILABLE: 'AI를 쓸 수 없어',
  AI_RATE_LIMITED: 'AI 사용량 한도에 도달해',
  AI_TIMEOUT: 'AI 응답이 늦어',
};

export interface AiHintProps {
  exerciseId: string;
  /** Hint level already opened (the AI hint never opens a new level). */
  level: number;
  /** Request body at click time (practice item, current code, last run). */
  request: () => AIHintRequest;
}

/**
 * "AI에게 이 단계 다시 설명받기" under the opened hints (ui-ux.md 힌트 사다리): the same level,
 * personalized by `POST /exercises/:id/ai-hint`. When AI cannot help, the server answers with
 * the authored hint and the reason, which is shown as such.
 */
export function AiHint({ exerciseId, level, request }: AiHintProps) {
  const ai = useAiAvailability();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AIHintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = result?.level === level ? result : null;

  const ask = async () => {
    if (pending || !ai.usable) return;
    setPending(true);
    setError(null);
    try {
      setResult(await requestAiHint(exerciseId, request()));
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : 'AI 힌트를 받지 못했어요. 다시 시도해 주세요.',
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
      {current ? 'AI에게 다시 설명받기' : 'AI에게 이 단계 다시 설명받기'}
    </Button>
  );

  return (
    <div className="ai-hint">
      {ai.usable ? button : <Tooltip content={ai.reason ?? 'AI 연결이 필요해요'}>{button}</Tooltip>}
      {!ai.usable && <p className="pi-ex-hints__note">{ai.reason ?? 'AI 연결이 필요해요'}</p>}
      <div role="status">
        {pending && <p className="pi-ex-hints__note">{level}단계 힌트를 다시 쓰고 있어요…</p>}
        {error && <p className="practice-error">{error}</p>}
        {current &&
          (current.source === 'ai' ? (
            <section className="ai-hint__result" aria-label={`AI 힌트 ${current.level}단계`}>
              <p className="ai-hint__title">
                <Badge variant="ai">AI</Badge> {current.level}단계 다시 설명
              </p>
              <Markdown text={current.hintMarkdown} variant="ai" />
              {current.focusLine !== null && (
                <p className="ai-hint__extra">에디터 {current.focusLine}번째 줄을 살펴보세요.</p>
              )}
              {current.checkQuestion && (
                <p className="ai-hint__extra">
                  <strong>스스로 확인:</strong> {current.checkQuestion}
                </p>
              )}
            </section>
          ) : (
            <section className="ai-hint__fallback" aria-label="작성된 힌트">
              <p className="pi-ex-hints__note">
                {(current.fallbackCode && FALLBACK_REASONS[current.fallbackCode]) ??
                  'AI 힌트를 만들지 못해'}{' '}
                작성된 힌트를 다시 보여 드려요.
              </p>
              <Markdown text={current.hintMarkdown} />
            </section>
          ))}
      </div>
    </div>
  );
}
