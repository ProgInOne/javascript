import type { AIStatus } from '@proginone/shared';
import { AIError } from '../errors.ts';

/**
 * The error an AI request gets in a provider state, or `null` when requests can run (`ready`).
 * Shared by the adapters and the server's pre-checks so both report the same code.
 */
export function errorForStatus(status: AIStatus): AIError | null {
  switch (status.state) {
    case 'ready':
      return null;
    case 'logged_out':
      return new AIError('AI_NOT_CONNECTED');
    case 'rate_limited':
      return new AIError('AI_RATE_LIMITED', { details: { resetsAt: status.resetsAt } });
    case 'starting':
    case 'idle':
      return new AIError('AI_PROVIDER_ERROR', {
        message: 'AI 튜터에 연결하는 중입니다. 잠시 후 다시 시도하세요.',
        details: { reason: 'starting' },
      });
    case 'not_installed':
      return new AIError('AI_UNAVAILABLE', {
        message: 'Codex CLI가 설치되어 있지 않아 AI 튜터를 쓸 수 없습니다.',
        details: { reason: 'not_installed' },
      });
    case 'unsupported_version':
      return new AIError('AI_UNAVAILABLE', {
        message: `Codex ${status.required} 이상이 필요합니다(현재 ${status.found}).`,
        details: { reason: 'unsupported_version' },
      });
    case 'isolation_failed':
      return new AIError('AI_UNAVAILABLE', {
        message: '튜터 격리 설정을 확인하지 못해 AI 튜터를 껐습니다.',
        details: { reason: 'isolation_failed', problems: status.problems },
      });
    case 'error':
      return new AIError('AI_UNAVAILABLE', {
        message: status.message,
        details: { reason: 'error' },
      });
  }
}
