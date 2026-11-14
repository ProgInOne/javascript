// Codex App Server protocol: the subset ProgInOne uses, transcribed from
// `codex app-server generate-ts` of codex-cli 0.155.1 (the version validated in M1-A,
// poc/codex-tutor). Only what we send and read is typed; unknown fields are ignored.
// To update: upgrade Codex → regenerate into a scratch directory → compare these shapes →
// update the recorded contract fixtures → raise MIN_CODEX_VERSION.

/** Version the shapes below were checked against. */
export const PROTOCOL_CODEX_VERSION = '0.155.1';
/** Oldest Codex CLI the adapter accepts (docs/design/ai-system.md#버전-고정과-타입-생성). */
export const MIN_CODEX_VERSION = '0.155.1';

export type RequestId = string | number;

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  id: RequestId;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export interface InitializeParams {
  clientInfo: { name: string; title: string | null; version: string };
  capabilities: {
    experimentalApi: boolean;
    requestAttestation: boolean;
    optOutNotificationMethods?: string[];
  };
}

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export type AskForApproval = 'untrusted' | 'on-request' | 'never' | Record<string, unknown>;
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/** `thread/start` (and the override subset of `thread/resume`). */
export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: SandboxMode | null;
  config?: Record<string, unknown> | null;
  serviceName?: string | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean | null;
}

export interface ThreadResumeParams extends Omit<ThreadStartParams, 'serviceName' | 'ephemeral'> {
  threadId: string;
  excludeTurns?: boolean;
}

export type SandboxPolicy =
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'dangerFullAccess' }
  | { type: 'workspaceWrite' }
  | { type: 'externalSandbox' };

/** `thread/start` and `thread/resume` responses carry the effective settings. */
export interface ThreadStartResponse {
  thread: { id: string };
  model: string;
  cwd: string;
  approvalPolicy: AskForApproval;
  sandbox: SandboxPolicy;
}

export interface UserInputText {
  type: 'text';
  text: string;
  text_elements: unknown[];
}

export interface TurnStartParams {
  threadId: string;
  input: UserInputText[];
  effort?: string | null;
  outputSchema?: unknown;
  model?: string | null;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

/** String variants or `{ variantName: {...} }` objects. */
export type CodexErrorInfo = string | Record<string, unknown>;

export interface TurnError {
  message: string;
  codexErrorInfo: CodexErrorInfo | null;
  additionalDetails: string | null;
}

export interface Turn {
  id: string;
  status: TurnStatus;
  error: TurnError | null;
}

export interface TurnStartResponse {
  turn: Turn;
}

/** A thread item; `type` decides the rest. */
export interface ThreadItem {
  type: string;
  id: string;
  text?: string;
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  /** Unix seconds. */
  resetsAt: number | null;
}

export interface RateLimitSnapshot {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  planType?: string | null;
}

export interface GetAccountResponse {
  account: { type: string; planType?: string | null } | null;
  requiresOpenaiAuth: boolean;
}

export interface LoginChatgptResponse {
  type: 'chatgpt';
  loginId: string;
  authUrl: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: ({ reasoningEffort: string } | string)[];
}

/**
 * Thread item types that are not tool use. Everything else (`commandExecution`, `fileChange`,
 * `mcpToolCall`, `webSearch`, `dynamicToolCall`, `collabAgentToolCall`, `imageGeneration`,
 * `imageView`, `subAgentActivity`, `sleep`, `plan`, unknown future types, …) interrupts the turn
 * (fail closed, D-002).
 */
export const NON_TOOL_ITEM_TYPES: ReadonlySet<string> = new Set([
  'userMessage',
  'agentMessage',
  'reasoning',
  'contextCompaction',
]);

/** Notifications the tutor never reads (`initialize.optOutNotificationMethods`). */
export const OPT_OUT_NOTIFICATIONS = [
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/plan/delta',
  'turn/diff/updated',
  'turn/plan/updated',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'rawResponseItem/completed',
  'rawResponse/completed',
];

/** JSON-RPC overload error (docs: 백오프 후 재시도). */
export const RPC_OVERLOADED = -32001;
export const RPC_METHOD_NOT_FOUND = -32601;
