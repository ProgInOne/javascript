import { Tooltip } from '@proginone/ui';
import { Link } from '@tanstack/react-router';
import { useAiStatus } from './api.ts';
import { describeAi } from './status.ts';

/**
 * AIStatusIndicator (ui-ux.md 학습 특화 컴포넌트): dot + text in the header, a link to the
 * settings AI section. Reads the event stream's snapshot only, so it never starts Codex.
 */
export function AIStatusIndicator() {
  const { data } = useAiStatus();
  const ai = describeAi(data);
  const used = data?.status.state === 'ready' ? (data.usage?.highestUsedPercent ?? null) : null;
  const hint =
    ai.reason ??
    (used !== null && used >= 80 ? `사용량 ${Math.round(used)}%` : 'AI 연결 설정 열기');
  return (
    <Tooltip content={hint} side="bottom">
      <Link
        to="/settings/ai"
        className="ai-indicator"
        data-ai-state={data ? (data.pendingLogin ? 'login' : data.status.state) : 'loading'}
        data-tone={ai.tone}
      >
        <span className="ai-indicator__dot" aria-hidden="true" />
        <span>AI</span> <span className="ai-indicator__label">{ai.label}</span>
      </Link>
    </Tooltip>
  );
}
