import type { AIStatusResponse, AIUsageWindow } from '@proginone/shared';
import { formatResetTime } from '../../lib/format.ts';

/** Dot color of the AI status. Always shown next to text, never alone (WCAG 1.4.1). */
export type AiTone = 'ok' | 'warn' | 'error' | 'neutral';

export interface AiAvailability {
  /** Short label for the header indicator, e.g. "연결됨". */
  label: string;
  tone: AiTone;
  /** Tutor questions and AI hints can be sent (or will start the provider on first use). */
  usable: boolean;
  /** Why AI entry points are disabled ("오프라인·AI 불가", ui-ux.md 공통 상태 디자인). */
  reason: string | null;
}

export const AI_NOT_CONNECTED_COPY =
  'AI 튜터를 쓰려면 ChatGPT 계정을 연결해 주세요. 연결하지 않아도 모든 문제와 해설은 볼 수 있어요.';

/** "AI 사용량 한도에 도달했어요. 14:30에 다시 쓸 수 있어요." (ui-ux.md 마이크로카피). */
export function rateLimitCopy(resetsAt: string | null, now?: Date): string {
  const at = formatResetTime(resetsAt, now);
  return at
    ? `AI 사용량 한도에 도달했어요. ${at}에 다시 쓸 수 있어요.`
    : 'AI 사용량 한도에 도달했어요. 초기화된 뒤에 다시 쓸 수 있어요.';
}

/**
 * What the AI state means for the UI. `undefined` (state not known yet) does not block entry
 * points: the server still refuses with an AI error, which is then shown.
 */
export function describeAi(res: AIStatusResponse | undefined, now = new Date()): AiAvailability {
  if (!res) return { label: '확인 중', tone: 'neutral', usable: true, reason: null };
  if (res.pendingLogin && res.status.state !== 'ready') {
    return {
      label: '로그인 진행 중',
      tone: 'neutral',
      usable: false,
      reason: '브라우저에서 ChatGPT 로그인을 마쳐 주세요.',
    };
  }
  const status = res.status;
  switch (status.state) {
    case 'idle':
      // Codex starts lazily on the first question (docs/design/ai-system.md).
      return { label: '대기 중', tone: 'neutral', usable: true, reason: null };
    case 'starting':
      return { label: '연결 중', tone: 'neutral', usable: true, reason: null };
    case 'ready': {
      const used = res.usage?.highestUsedPercent ?? null;
      if (used !== null && used >= 100) {
        return { label: '한도 도달', tone: 'error', usable: true, reason: null };
      }
      if (used !== null && used >= 80) {
        return { label: '사용량 경고', tone: 'warn', usable: true, reason: null };
      }
      return { label: '연결됨', tone: 'ok', usable: true, reason: null };
    }
    case 'rate_limited': {
      const resetsAt = status.resetsAt ? Date.parse(status.resetsAt) : Number.NaN;
      if (!Number.isNaN(resetsAt) && resetsAt <= now.getTime()) {
        // The server lets requests through once the reset time has passed.
        return { label: '연결됨', tone: 'ok', usable: true, reason: null };
      }
      return {
        label: '한도 도달',
        tone: 'error',
        usable: false,
        reason: rateLimitCopy(status.resetsAt, now),
      };
    }
    case 'logged_out':
      return { label: '연결 안 됨', tone: 'neutral', usable: false, reason: 'AI 연결이 필요해요' };
    case 'not_installed':
      return {
        label: 'Codex CLI 미설치',
        tone: 'error',
        usable: false,
        reason: 'Codex CLI를 설치해야 AI 튜터를 쓸 수 있어요',
      };
    case 'unsupported_version':
      return {
        label: '지원하지 않는 버전',
        tone: 'error',
        usable: false,
        reason: 'Codex CLI를 업데이트해야 AI 튜터를 쓸 수 있어요',
      };
    case 'isolation_failed':
      return {
        label: '격리 실패',
        tone: 'error',
        usable: false,
        reason: 'AI 안전 설정을 확인하지 못해 튜터를 꺼 두었어요',
      };
    case 'error':
      return {
        label: '연결 오류',
        tone: 'error',
        usable: false,
        reason: 'AI에 연결하지 못했어요. 설정에서 다시 연결해 주세요',
      };
  }
}

/** "5시간 한도", "주간 한도": the provider's window length in learner words. */
export function windowLabel(window: AIUsageWindow): string {
  const mins = window.windowDurationMins;
  if (mins === null || mins <= 0) return window.id === 'primary' ? '기본 한도' : '보조 한도';
  if (mins === 10_080) return '주간 한도';
  if (mins % 1_440 === 0) return `${mins / 1_440}일 한도`;
  if (mins % 60 === 0) return `${mins / 60}시간 한도`;
  return `${mins}분 한도`;
}

/** Usage level: amber from 80%, red at 100% (ui-ux.md 설정 AI 섹션). */
export function usageLevel(percent: number): 'normal' | 'warn' | 'full' {
  if (percent >= 100) return 'full';
  if (percent >= 80) return 'warn';
  return 'normal';
}

/** ChatGPT plan type as shown to the learner ("pro" → "Pro"). Never the account email. */
export function planLabel(planType: string | null): string | null {
  if (!planType) return null;
  return planType.charAt(0).toUpperCase() + planType.slice(1);
}
