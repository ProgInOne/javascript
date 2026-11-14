import { RPC_METHOD_NOT_FOUND } from './protocol.ts';
import type { ServerRequestReply } from './rpc.ts';

// Every server-initiated request is refused: the tutor never uses tools
// (docs/design/ai-system.md#서버-요청-처리-승인-자동-거부). Shapes follow codex-cli 0.155.1.

const DENIED_REASON = 'ProgInOne 튜터는 도구를 사용하지 않습니다.';

const DENY: Record<string, () => unknown> = {
  'item/commandExecution/requestApproval': () => ({ decision: 'decline' }),
  'item/fileChange/requestApproval': () => ({ decision: 'decline' }),
  'item/permissions/requestApproval': () => ({ permissions: {}, scope: 'turn' }),
  'mcpServer/elicitation/request': () => ({ action: 'decline', content: null, _meta: null }),
  'item/tool/requestUserInput': () => ({ answers: {} }),
  'item/tool/call': () => ({ success: false, contentItems: [] }),
  // v1 approvals: ReviewDecision `{ denied: { rejection } }`.
  applyPatchApproval: () => ({ decision: { denied: { rejection: DENIED_REASON } } }),
  execCommandApproval: () => ({ decision: { denied: { rejection: DENIED_REASON } } }),
};

export interface DenyOutcome {
  reply: ServerRequestReply;
  /** A known tool/approval request (counts as a tool attempt). */
  toolRequest: boolean;
}

export function denyServerRequest(method: string): DenyOutcome {
  const make = DENY[method];
  if (make) return { reply: { result: make() }, toolRequest: true };
  return {
    reply: { error: { code: RPC_METHOD_NOT_FOUND, message: 'Method not found' } },
    toolRequest: false,
  };
}
