import { pickModel, type AIModel, type AIStatusResponse, type AIUsage } from '@proginone/shared';
import {
  Button,
  Dialog,
  ErrorState,
  ProgressBar,
  RadioGroup,
  Skeleton,
  Spinner,
  useToast,
} from '@proginone/ui';
import { CircleAlert, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { useSettings } from '../../api/queries.ts';
import { cardClass, pageTitleClass } from '../../app/layout.ts';
import { formatResetTime } from '../../lib/format.ts';
import { useSaveSetting } from '../settings/useSaveSetting.ts';
import { useAiCancelLogin, useAiLogout, useAiModels, useAiReconnect, useAiStatus } from './api.ts';
import { LoginDialog, useAiLogin } from './LoginDialog.tsx';
import {
  AI_NOT_CONNECTED_COPY,
  describeAi,
  planLabel,
  rateLimitCopy,
  usageLevel,
  windowLabel,
} from './status.ts';

const INSTALL_COMMAND = 'npm install -g @openai/codex';

/** 설정 > AI (docs/design/ui-ux.md#설정 "AI 연결 섹션"). Opening it starts Codex lazily. */
export function AiSettings() {
  const status = useAiStatus({ connect: true });
  return (
    <section aria-labelledby="ai-title" className="max-w-[760px]">
      <h1 id="ai-title" className={pageTitleClass}>
        AI
      </h1>
      <div className={`${cardClass} ai-settings`}>
        <h2 className="type-h3 text-heading">AI 튜터 연결</h2>
        {status.data ? (
          <Connection data={status.data} />
        ) : status.isError ? (
          <ErrorState
            variant="inline"
            title="AI 연결 상태를 불러오지 못했어요"
            description={status.error.message}
            action={<Button onClick={() => void status.refetch()}>다시 시도</Button>}
          />
        ) : (
          <Skeleton height={96} />
        )}
      </div>
      <AiDataScope />
    </section>
  );
}

/**
 * "AI에 보내는 정보" (NFR-08, ai-system.md#개인정보): what the AI tasks send, and what never
 * leaves the computer. Static copy; the per-call preview is P1. Shown whatever the connection
 * state, so the learner can read it before connecting.
 */
export function AiDataScope() {
  return (
    <section aria-labelledby="ai-data-title" className={`${cardClass} ai-data-scope mt-4`}>
      <h2 id="ai-data-title" className="type-h3 text-heading">
        AI에 보내는 정보
      </h2>
      <p className="ai-settings__note">
        학습 기록은 이 컴퓨터에만 저장돼요. AI 기능을 쓸 때만, 그 질문에 필요한 학습 맥락을 Codex를
        거쳐 OpenAI로 보내요.
      </p>
      <h3 className="ai-settings__section-title">보내는 것 (AI를 쓸 때만)</h3>
      <ul className="ai-data-scope__list">
        <li>질문, 그리고 지금 보고 있는 레슨·문제의 내용</li>
        <li>
          내 코드와 마지막 실행 결과 (튜터 창의 &quot;내 코드&quot;·&quot;실행 결과&quot;를 빼면
          보내지 않아요)
        </li>
        <li>관련 개념의 숙련도, 진행 중인 오개념, 이 문제의 최근 풀이 기록</li>
        <li>이 문제·단원의 이전 대화와 지난 대화의 요약</li>
        <li>힌트와 정답은 내가 이미 열어 본 만큼만 보내요. 단원 평가 중에는 AI를 쓸 수 없어요.</li>
      </ul>
      <h3 className="ai-settings__section-title">보내지 않는 것</h3>
      <ul className="ai-data-scope__list">
        <li>이름·이메일 같은 계정 정보 (로그인은 Codex가 관리해요)</li>
        <li>다른 문제의 코드, 학습 목표와 학습 시간, 설정, 백업 파일</li>
      </ul>
      <p className="ai-settings__note">
        보낸 내용은 OpenAI의 ChatGPT·Codex 데이터 정책을 따라요. AI를 연결하지 않으면 아무것도
        보내지 않아요.
      </p>
    </section>
  );
}

function Connection({ data }: { data: AIStatusResponse }) {
  const toast = useToast();
  const login = useAiLogin();
  const logout = useAiLogout();
  const reconnect = useAiReconnect();
  const cancelLogin = useAiCancelLogin();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const ai = describeAi(data);
  const { status } = data;
  const connected = status.state === 'ready' || status.state === 'rate_limited';
  const models = useAiModels(status.state === 'ready');

  const onReconnect = () => {
    reconnect.mutate(undefined, {
      onError: (e) => {
        toast({ title: '다시 연결하지 못했어요', description: e.message, variant: 'error' });
      },
    });
  };
  const reconnectButton = (label: string) => (
    <Button
      icon={<RefreshCw size={16} aria-hidden="true" />}
      loading={reconnect.isPending}
      onClick={onReconnect}
    >
      {label}
    </Button>
  );
  const connectButton = (
    <Button
      variant="primary"
      icon={<LogIn size={16} aria-hidden="true" />}
      loading={login.state.phase === 'starting'}
      onClick={() => void login.start()}
    >
      ChatGPT로 연결
    </Button>
  );

  let title: ReactNode = ai.label;
  let body: ReactNode = null;
  let action: ReactNode = null;
  if (data.pendingLogin && status.state !== 'ready' && login.state.phase === 'idle') {
    // A login started elsewhere (another tab) is still open on the server.
    body = <p className="ai-settings__note">브라우저에서 ChatGPT 로그인을 마쳐 주세요.</p>;
    action = (
      <Button
        loading={cancelLogin.isPending}
        onClick={() => {
          cancelLogin.mutate({ loginId: data.pendingLogin?.loginId });
        }}
      >
        로그인 취소
      </Button>
    );
  } else {
    switch (status.state) {
      case 'idle':
      case 'starting':
        title = (
          <span className="ai-login__progress">
            <Spinner /> 연결하는 중…
          </span>
        );
        body = <p className="ai-settings__note">Codex를 시작하고 로그인 상태를 확인하고 있어요.</p>;
        break;
      case 'ready': {
        const plan = planLabel(status.planType);
        title = plan ? `연결됨 · ChatGPT ${plan}` : '연결됨';
        action = (
          <Button
            icon={<LogOut size={16} aria-hidden="true" />}
            onClick={() => {
              setConfirmLogout(true);
            }}
          >
            연결 해제
          </Button>
        );
        break;
      }
      case 'rate_limited':
        title = '연결됨 · 한도 도달';
        body = (
          <p className="ai-settings__note">
            {rateLimitCopy(status.resetsAt)} 그동안 힌트와 해설은 계속 볼 수 있어요.
          </p>
        );
        break;
      case 'logged_out':
        body = <p className="ai-settings__note">{AI_NOT_CONNECTED_COPY}</p>;
        action = connectButton;
        break;
      case 'not_installed':
        title = 'Codex CLI가 설치되어 있지 않아요';
        body = (
          <div className="ai-settings__note">
            <p>
              AI 튜터는 Codex CLI로 ChatGPT 계정에 연결해요. 터미널에서 설치한 뒤 다시 확인해
              주세요.
            </p>
            <code className="ai-settings__command">{INSTALL_COMMAND}</code>
            {status.hint && <p className="mt-2">{status.hint}</p>}
          </div>
        );
        action = reconnectButton('다시 확인');
        break;
      case 'unsupported_version':
        title = '지원하지 않는 Codex CLI 버전이에요';
        body = (
          <div className="ai-settings__note">
            <p>
              설치된 버전은 {status.found}이에요. {status.required} 이상으로 업데이트한 뒤 다시
              확인해 주세요.
            </p>
            <code className="ai-settings__command">{INSTALL_COMMAND}@latest</code>
          </div>
        );
        action = reconnectButton('다시 확인');
        break;
      case 'isolation_failed':
        title = 'AI 안전 설정을 확인하지 못했어요';
        body = (
          <div className="ai-settings__note">
            <p>
              튜터가 셸·파일·웹 도구를 쓰지 못하도록 막는 설정을 확인하지 못해 튜터를 꺼 두었어요.
              Codex CLI를 업데이트했다면 앱 업데이트가 필요할 수 있어요.
            </p>
            {status.problems.length > 0 && (
              <ul className="ai-settings__problems">
                {status.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        );
        action = reconnectButton('다시 확인');
        break;
      case 'error':
        title = 'AI에 연결하지 못했어요';
        body = (
          <div className="ai-settings__note">
            <p>{status.message}</p>
            <p className="pi-state__code mt-1">
              오류 코드 <code>{status.code}</code>
            </p>
          </div>
        );
        action = reconnectButton('다시 연결');
        break;
    }
  }

  return (
    <>
      <div className="ai-settings__status">
        <div className="grid gap-1" aria-live="polite">
          <p className="ai-settings__state" data-tone={ai.tone}>
            <span className="ai-dot" aria-hidden="true" />
            {title}
          </p>
          <p className="ai-settings__note">
            제공자: {data.provider === 'mock' ? '테스트용 모의 AI' : 'Codex App Server'}
          </p>
          {body}
        </div>
        {action}
      </div>

      {connected && data.usage && data.usage.windows.length > 0 && <Usage usage={data.usage} />}

      {status.state === 'ready' && models.data && models.data.models.length > 0 && (
        <ModelPicker models={models.data.models} />
      )}

      <LoginDialog login={login} />

      <Dialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="AI 연결을 해제할까요?"
        description="학습 기록과 튜터 대화는 그대로 남아요. 다시 쓰려면 ChatGPT 로그인이 필요해요."
        footer={
          <>
            <Button
              onClick={() => {
                setConfirmLogout(false);
              }}
            >
              취소
            </Button>
            <Button
              variant="danger"
              loading={logout.isPending}
              onClick={() => {
                logout.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmLogout(false);
                    toast({ title: 'AI 연결을 해제했어요', variant: 'success' });
                  },
                  onError: (e) => {
                    toast({
                      title: '연결을 해제하지 못했어요',
                      description: e instanceof ApiRequestError ? e.message : undefined,
                      variant: 'error',
                    });
                  },
                });
              }}
            >
              연결 해제
            </Button>
          </>
        }
      />
    </>
  );
}

const EFFORT_LABELS: Record<string, string> = {
  none: '없음',
  minimal: '최소',
  low: '낮음',
  medium: '보통',
  high: '높음',
  xhigh: '매우 높음',
};

/**
 * 모델 선택 (FR-SET-01, ai-system.md#모델-선택, D-060): the provider's visible models with their
 * description and reasoning efforts. Choosing the default model stores `null` so the learner keeps
 * following the provider's default; a saved model the provider no longer lists is explained and
 * the default is used until another model is chosen.
 */
function ModelPicker({ models }: { models: readonly AIModel[] }) {
  const settings = useSettings();
  const { save, pending } = useSaveSetting();
  if (!settings.data) return null;
  const saved = settings.data['ai.model'];
  const { model: current, fallback } = pickModel(models, saved);
  return (
    <section aria-labelledby="ai-models-title" className="ai-models">
      <h3 id="ai-models-title" className="ai-settings__section-title">
        모델
      </h3>
      {fallback && (
        <p className="ai-models__fallback" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            저장한 모델({saved})을 더 이상 쓸 수 없어서{' '}
            {current ? `기본 모델(${current.displayName})` : 'Codex 기본 모델'}로 답해요. 다른
            모델을 고르면 바뀌어요.
          </span>
        </p>
      )}
      <RadioGroup
        legend="튜터와 AI 기능이 쓸 모델"
        value={current?.id}
        disabled={pending}
        options={models.map((m) => ({
          value: m.id,
          label: m.isDefault ? `${m.displayName} (기본)` : m.displayName,
          description: modelDescription(m),
        }))}
        onValueChange={(id) => {
          const picked = models.find((m) => m.id === id);
          save({ 'ai.model': !picked || picked.isDefault ? null : picked.id }, '모델');
        }}
      />
      <p className="ai-settings__note mt-2">
        바꾼 모델은 다음 질문부터 쓰여요. 진행 중이던 튜터 대화는 새 모델로 이어서 답해요.
      </p>
    </section>
  );
}

function modelDescription(m: AIModel): string {
  const efforts = m.supportedEfforts.map((e) => EFFORT_LABELS[e] ?? e).join('·');
  return [m.description, efforts && `추론 강도 ${efforts}`].filter(Boolean).join(' · ');
}

/** Provider-reported usage windows only (no app-side estimates). */
function Usage({ usage }: { usage: AIUsage }) {
  const highest = usage.highestUsedPercent ?? 0;
  return (
    <section aria-labelledby="ai-usage-title">
      <h3 id="ai-usage-title" className="ai-settings__section-title">
        사용량
      </h3>
      <ul className="ai-usage">
        {usage.windows.map((w) => {
          const percent = Math.max(0, Math.round(w.usedPercent));
          const level = usageLevel(percent);
          const reset = formatResetTime(w.resetsAt);
          const label = windowLabel(w);
          return (
            <li key={w.id} className="ai-usage__row" data-level={level}>
              <span className="ai-usage__label">{label}</span>
              <ProgressBar value={Math.min(percent, 100)} label={`${label} 사용량`} size={8} />
              <span className="ai-usage__value">
                {level === 'full' ? `${percent}% · 한도 도달` : `${percent}%`}
                {reset && ` · ${reset} 초기화`}
              </span>
            </li>
          );
        })}
      </ul>
      {highest >= 95 ? (
        <p className="ai-settings__note mt-3">
          사용량이 많아 튜터 대화만 쓸 수 있어요. AI 문제 생성 등 백그라운드 작업은 잠시 미뤄요.
        </p>
      ) : highest >= 80 ? (
        <p className="ai-settings__note mt-3">AI 문제 생성 등 백그라운드 작업은 잠시 미뤄요.</p>
      ) : null}
      <p className="ai-settings__note mt-1">사용량은 Codex가 알려 준 값이에요.</p>
    </section>
  );
}
