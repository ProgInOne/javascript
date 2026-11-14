import { isAIError } from '../../../errors.ts';
import { baseInstructions } from '../../../prompts/base.ts';
import type { ProviderRequest, ProviderResponse } from '../../types.ts';
import type { CodexAdapter } from '../adapter.ts';

// Scenarios of the recorded Codex protocol contract (docs/design/ai-system.md#codex-프로토콜-계약-테스트).
// record-codex.ts drives the real `codex app-server` through these steps once and stores the
// JSON-RPC exchange; replay.test.ts drives a replaying fake through the same steps in CI. Keep a
// scenario's steps unchanged unless it is re-recorded: the replay matches requests by method and
// order.

export interface ScenarioOutcome {
  status: string;
  /** What each step produced (text, usage, error code), in order. */
  steps: Record<string, unknown>[];
}

export interface RecordedScenario {
  name: string;
  /** `logged_in`: a copy of a logged-in tutor home; `empty`: a fresh home (logged out). */
  home: 'logged_in' | 'empty';
  /** Real model turns this scenario costs when recorded. */
  modelCalls: number;
  run(adapter: CodexAdapter): Promise<ScenarioOutcome>;
}

const request = (over: Partial<ProviderRequest>): ProviderRequest => ({
  taskName: 'contract.test',
  baseInstructions: baseInstructions(),
  developerInstructions: '[현재 작업: 계약 테스트]\n- 짧게 답한다.',
  input: '<learner_question>\n안녕하세요\n</learner_question>',
  effort: 'low',
  thread: { kind: 'ephemeral' },
  timeoutMs: 90_000,
  ...over,
});

const summarize = (res: ProviderResponse, deltas: string[]) => ({
  text: res.text,
  deltaCount: deltas.length,
  deltaText: deltas.join(''),
  model: res.model,
  threadId: res.providerThreadId,
  turnId: res.providerTurnId,
  usage: res.usage,
  toolAttempts: res.toolAttempts,
});

const failure = (e: unknown) =>
  isAIError(e)
    ? { error: e.code, threadLost: e.threadLost, partialText: e.partialText }
    : { error: String(e) };

async function turn(adapter: CodexAdapter, req: ProviderRequest): Promise<Record<string, unknown>> {
  const deltas: string[] = [];
  try {
    const res = await adapter.run(req, {
      signal: new AbortController().signal,
      onDelta: (d) => deltas.push(d),
    });
    return summarize(res, deltas);
  } catch (e) {
    return { ...failure(e), deltaCount: deltas.length };
  }
}

export const RECORDED_SCENARIOS: RecordedScenario[] = [
  {
    name: 'login-logged-out',
    home: 'empty',
    modelCalls: 0,
    async run(adapter) {
      const status = await adapter.connect();
      const usage = await adapter.usage();
      const login = await adapter.login();
      const pending = adapter.pendingLogin();
      await adapter.cancelLogin(login.loginId);
      return {
        status: status.state,
        steps: [
          { status },
          { usage },
          { loginStarted: login.authUrl.startsWith('https://'), pending: pending !== null },
          { pendingAfterCancel: adapter.pendingLogin() },
        ],
      };
    },
  },
  {
    name: 'startup-ready',
    home: 'logged_in',
    modelCalls: 0,
    async run(adapter) {
      const status = await adapter.connect();
      const usage = await adapter.usage();
      const models = await adapter.listModels();
      return {
        status: status.state,
        steps: [
          { status },
          { usage: usage ? { ...usage, updatedAt: 0 } : null },
          { models: models.map((m) => ({ id: m.id, isDefault: m.isDefault })) },
        ],
      };
    },
  },
  {
    name: 'turn-stream',
    home: 'logged_in',
    modelCalls: 1,
    async run(adapter) {
      const status = await adapter.connect();
      const result = await turn(
        adapter,
        request({
          input:
            '<learner_question entry_point="free">\nconsole.log는 무엇을 하나요? 두 문장으로 답해 주세요.\n</learner_question>',
        }),
      );
      return { status: status.state, steps: [result] };
    },
  },
  {
    name: 'turn-structured',
    home: 'logged_in',
    modelCalls: 1,
    async run(adapter) {
      const status = await adapter.connect();
      const result = await turn(
        adapter,
        request({
          developerInstructions:
            '[현재 작업: 오답 분석]\n- 지정된 JSON 형식으로만 답한다. summary는 한 문장 진단이다.',
          input: [
            '<grading_result outcome="incorrect">',
            '학습자가 let total; 로 선언한 뒤 total += 1 을 실행했고 결과가 NaN이었다.',
            '</grading_result>',
            '<learner_question entry_point="mistake_followup">\n왜 틀렸나요?\n</learner_question>',
          ].join('\n'),
          outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'nextStep'],
            properties: {
              summary: { type: 'string', maxLength: 200 },
              nextStep: { type: 'string', enum: ['retry', 'open_hint', 'review_concept'] },
            },
          },
        }),
      );
      return { status: status.state, steps: [result] };
    },
  },
  {
    name: 'thread-resume',
    home: 'logged_in',
    modelCalls: 2,
    async run(adapter) {
      const status = await adapter.connect();
      const first = await turn(
        adapter,
        request({
          thread: { kind: 'persistent', resumeId: null },
          input:
            '<learner_question entry_point="free">\n변수 이름으로 count를 쓰려고 해요. 한 문장으로 괜찮은지 알려 주세요.\n</learner_question>',
        }),
      );
      const threadId = typeof first['threadId'] === 'string' ? first['threadId'] : null;
      const second = await turn(
        adapter,
        request({
          thread: { kind: 'persistent', resumeId: threadId },
          input:
            '<learner_question entry_point="free">\n방금 제가 말한 변수 이름이 무엇이었는지 한 단어로 답해 주세요.\n</learner_question>',
        }),
      );
      const lost = await turn(
        adapter,
        request({
          thread: { kind: 'persistent', resumeId: '00000000-0000-7000-8000-00000000dead' },
        }),
      );
      return { status: status.state, steps: [first, second, lost] };
    },
  },
  {
    name: 'turn-interrupt',
    home: 'logged_in',
    modelCalls: 1,
    async run(adapter) {
      const status = await adapter.connect();
      const controller = new AbortController();
      const deltas: string[] = [];
      let outcome: Record<string, unknown>;
      try {
        await adapter.run(
          request({
            input:
              '<learner_question entry_point="free">\nJavaScript의 반복문 종류를 예제와 함께 아주 자세히 설명해 주세요.\n</learner_question>',
          }),
          {
            signal: controller.signal,
            onDelta: (d) => {
              deltas.push(d);
              if (deltas.length === 1) controller.abort();
            },
          },
        );
        outcome = { error: null };
      } catch (e) {
        outcome = failure(e);
      }
      return { status: status.state, steps: [{ ...outcome, deltaCount: deltas.length }] };
    },
  },
];
