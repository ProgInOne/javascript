import {
  EXPERIENCE_LEVELS,
  type CourseList,
  type ExperienceLevel,
  type GoalStatus,
} from '@proginone/shared';
import { Button, ErrorState, Skeleton } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, LogIn, Repeat, Target } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  coursesQuery,
  dailyPlanQuery,
  goalsQuery,
  learnerQuery,
  useSaveGoal,
  useUpdateLearner,
} from '../api/queries.ts';
import { cardClass } from '../app/layout.ts';
import { LogoMark } from '../app/Logo.tsx';
import { LoginDialog, useAiLogin } from '../features/ai/LoginDialog.tsx';
import { useAiStatus } from '../features/ai/api.ts';
import { draftOf, GoalFields, requestOf, type GoalDraft } from '../features/goals/GoalForm.tsx';
import { blockTitle } from '../features/dashboard/plan.ts';
import { formatMinutes } from '../lib/format.ts';

const STEPS = ['welcome', 'goal', 'experience', 'ai', 'start'] as const;
type Step = (typeof STEPS)[number];

/** Steps shown in the stepper (the welcome screen comes before it). */
const STEPPER: readonly { step: Step; label: string }[] = [
  { step: 'goal', label: '목표' },
  { step: 'experience', label: '경험' },
  { step: 'ai', label: 'AI' },
  { step: 'start', label: '시작' },
];

export const Route = createFileRoute('/onboarding')({
  validateSearch: (search: Record<string, unknown>): { step?: Step } => {
    const step = search['step'];
    return typeof step === 'string' && (STEPS as readonly string[]).includes(step)
      ? { step: step as Step }
      : {};
  },
  component: OnboardingPage,
});

/**
 * First-run onboarding (ui-ux.md#온보딩과-목표-설정): 환영 → 목표 → 경험 수준 → AI 연결(선택) →
 * 시작. Every step can be skipped; "온보딩 건너뛰기" leaves at once. Finishing or leaving sets
 * `onboarded_at`, so the dashboard never redirects here again.
 */
function OnboardingPage() {
  const { step = 'welcome' } = Route.useSearch();
  const navigate = useNavigate();
  const updateLearner = useUpdateLearner();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Each step change moves focus to the new step's heading (ui-ux.md 포커스 관리).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const go = (next: Step) => {
    void navigate({ to: '/onboarding', search: { step: next } });
  };
  const index = STEPS.indexOf(step);
  const back =
    index > 0
      ? () => {
          go(STEPS[index - 1] ?? 'welcome');
        }
      : undefined;
  const next = () => {
    go(STEPS[index + 1] ?? 'start');
  };

  /** Marks the onboarding done, then leaves to `to` (the dashboard or the first lesson). */
  const finish = async (to: { lessonId: string } | null) => {
    try {
      await updateLearner.mutateAsync({ onboarded: true });
    } catch {
      // Not fatal: the learner can still learn; the dashboard asks again next time.
    }
    if (to) await navigate({ to: '/learn/$lessonId', params: { lessonId: to.lessonId } });
    else await navigate({ to: '/' });
  };

  const heading = (text: string) => (
    <h1 ref={headingRef} tabIndex={-1} className="onboarding__title">
      {text}
    </h1>
  );

  return (
    <div className="onboarding">
      <div className="onboarding__top">
        <span className="inline-flex items-center gap-2 text-[17px] font-extrabold tracking-[-0.02em] text-heading">
          <LogoMark />
          <span>
            Prog<span className="text-brand">In</span>One
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          loading={updateLearner.isPending}
          onClick={() => void finish(null)}
        >
          온보딩 건너뛰기
        </Button>
      </div>
      <div className={`${cardClass} onboarding__card`}>
        {step !== 'welcome' && <Stepper current={step} />}
        {step === 'welcome' && <Welcome heading={heading} onStart={next} />}
        {step === 'goal' && <GoalStep heading={heading} onBack={back} onNext={next} />}
        {step === 'experience' && <ExperienceStep heading={heading} onBack={back} onNext={next} />}
        {step === 'ai' && <AiStep heading={heading} onBack={back} onNext={next} />}
        {step === 'start' && (
          <StartStep
            heading={heading}
            onBack={back}
            finishing={updateLearner.isPending}
            onFinish={(to) => void finish(to)}
          />
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const at = STEPPER.findIndex((s) => s.step === current);
  return (
    <ol className="onboarding__stepper" aria-label="온보딩 단계">
      {STEPPER.map((s, i) => (
        <li
          key={s.step}
          data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="onboarding__step-num" aria-hidden="true">
            {i < at ? '✓' : i + 1}
          </span>
          {s.label}
          {i < at && <span className="sr-only"> (완료)</span>}
        </li>
      ))}
    </ol>
  );
}

type Heading = (text: string) => ReactNode;

function StepActions({
  onBack,
  children,
}: {
  onBack: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <div className="onboarding__actions">
      {onBack ? (
        <Button variant="ghost" icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={onBack}>
          이전
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap justify-end gap-2">{children}</div>
    </div>
  );
}

function Welcome({ heading, onStart }: { heading: Heading; onStart: () => void }) {
  const ways = [
    { icon: BookOpen, title: '레슨', text: '짧게 읽고 바로 실행해 봐요.' },
    { icon: Target, title: '연습', text: '여러 유형의 문제로 직접 풀어요.' },
    { icon: Repeat, title: '복습', text: '잊을 즈음 다시 떠올려 오래 기억해요.' },
  ];
  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        {heading('코딩 공부, 이제 한 곳에서 끝까지.')}
        <p className="text-fg-secondary type-body">
          레슨 → 연습 → 복습이 하나로 이어지고, 기록은 모두 내 컴퓨터에 남아요.
        </p>
      </div>
      <ol className="onboarding__ways" aria-label="학습 방식">
        {ways.map(({ icon: Icon, title, text }, i) => (
          <li key={title}>
            <Icon size={24} aria-hidden="true" className="text-brand" />
            <p className="font-bold text-heading">
              <span className="sr-only">{i + 1}단계: </span>
              {title}
            </p>
            <p className="text-fg-secondary type-small">{text}</p>
          </li>
        ))}
      </ol>
      <p className="text-fg-secondary type-small">2분이면 끝나요. 모든 단계는 건너뛸 수 있어요.</p>
      <div className="flex justify-end">
        <Button
          variant="primary"
          icon={<ArrowRight size={16} aria-hidden="true" />}
          onClick={onStart}
        >
          시작하기
        </Button>
      </div>
    </div>
  );
}

function GoalStep({
  heading,
  onBack,
  onNext,
}: {
  heading: Heading;
  onBack: (() => void) | undefined;
  onNext: () => void;
}) {
  const goals = useQuery(goalsQuery);
  const courses = useQuery(coursesQuery);
  return (
    <div className="grid gap-6">
      {heading('학습 목표를 정해요')}
      {goals.isError || courses.isError ? (
        <>
          <ErrorState
            variant="inline"
            title="목표를 불러오지 못했어요"
            description="지금은 기본 목표(하루 30분, 주 5일)로 시작하고, 나중에 설정에서 바꿀 수 있어요."
          />
          <StepActions onBack={onBack}>
            <Button variant="primary" onClick={onNext}>
              다음
            </Button>
          </StepActions>
        </>
      ) : goals.data && courses.data ? (
        <GoalStepForm status={goals.data} courses={courses.data} onBack={onBack} onNext={onNext} />
      ) : (
        <Skeleton height={280} />
      )}
    </div>
  );
}

function GoalStepForm({
  status,
  courses,
  onBack,
  onNext,
}: {
  status: GoalStatus;
  courses: CourseList;
  onBack: (() => void) | undefined;
  onNext: () => void;
}) {
  const save = useSaveGoal();
  const [draft, setDraft] = useState<GoalDraft>(() => draftOf(status.goal, courses));
  const [errors, setErrors] = useState<Partial<Record<'minutes' | 'date', string>>>({});
  const submit = () => {
    const result = requestOf(draft, status.date);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.request, { onSuccess: onNext });
  };
  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <GoalFields
        draft={draft}
        onChange={setDraft}
        courses={courses}
        today={status.date}
        errors={errors}
        showEstimate
      />
      {save.isError && (
        <ErrorState
          variant="inline"
          title="목표를 저장하지 못했어요"
          description={save.error.message}
        />
      )}
      <StepActions onBack={onBack}>
        <Button onClick={onNext}>건너뛰기</Button>
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          icon={<ArrowRight size={16} aria-hidden="true" />}
        >
          다음
        </Button>
      </StepActions>
    </form>
  );
}

const EXPERIENCE: Readonly<Record<ExperienceLevel, { title: string; text: string }>> = {
  none: { title: '처음이에요', text: '코드를 거의 써 본 적이 없어요.' },
  some: { title: '조금 해봤어요', text: '따라 하며 코드를 조금 써 봤어요.' },
  basics: { title: '기초는 알아요', text: '변수, 조건문, 반복문 정도는 알아요.' },
};

function ExperienceStep({
  heading,
  onBack,
  onNext,
}: {
  heading: Heading;
  onBack: (() => void) | undefined;
  onNext: () => void;
}) {
  const learner = useQuery(learnerQuery);
  const update = useUpdateLearner();
  const [level, setLevel] = useState<ExperienceLevel | null>(null);
  const value = level ?? learner.data?.experienceLevel ?? 'none';
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ experienceLevel: value }, { onSuccess: onNext });
      }}
    >
      {heading('코딩은 얼마나 해 보셨나요?')}
      <fieldset className="onboarding__levels">
        <legend className="sr-only">경험 수준</legend>
        {EXPERIENCE_LEVELS.map((l) => (
          <label key={l} className="onboarding__level">
            <input
              type="radio"
              name="experience"
              value={l}
              checked={value === l}
              onChange={() => {
                setLevel(l);
              }}
            />
            <span className="font-bold text-heading">{EXPERIENCE[l].title}</span>
            <span className="text-fg-secondary type-small">{EXPERIENCE[l].text}</span>
          </label>
        ))}
      </fieldset>
      {value !== 'none' && (
        <p className="text-fg-secondary type-small" role="status">
          아는 단원은 바로 건너뛸 수 있어요. 학습 잠금이 없어서 과정 화면에서 어느 단원이든 열 수
          있어요.
        </p>
      )}
      {update.isError && (
        <ErrorState variant="inline" title="저장하지 못했어요" description={update.error.message} />
      )}
      <StepActions onBack={onBack}>
        <Button onClick={onNext}>건너뛰기</Button>
        <Button
          type="submit"
          variant="primary"
          loading={update.isPending}
          icon={<ArrowRight size={16} aria-hidden="true" />}
        >
          다음
        </Button>
      </StepActions>
    </form>
  );
}

function AiStep({
  heading,
  onBack,
  onNext,
}: {
  heading: Heading;
  onBack: (() => void) | undefined;
  onNext: () => void;
}) {
  const status = useAiStatus();
  const login = useAiLogin();
  const connected = status.data?.status.state === 'ready';
  return (
    <div className="grid gap-6">
      {heading('AI 튜터 연결 (선택)')}
      <div className="grid gap-2">
        <p className="type-body">AI 튜터를 쓰려면 ChatGPT 계정으로 연결하세요.</p>
        <p className="text-fg-secondary type-small">
          연결하지 않아도 레슨, 연습, 힌트, 해설, 복습을 모두 쓸 수 있어요. 나중에 설정 &gt; AI에서
          언제든 연결할 수 있어요.
        </p>
      </div>
      {connected && (
        <p className="onboarding__connected" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          AI 튜터가 연결되어 있어요.
        </p>
      )}
      <LoginDialog login={login} />
      <StepActions onBack={onBack}>
        {connected ? (
          <Button
            variant="primary"
            icon={<ArrowRight size={16} aria-hidden="true" />}
            onClick={onNext}
          >
            다음
          </Button>
        ) : (
          <>
            <Button onClick={onNext}>나중에 할게요</Button>
            <Button
              variant="primary"
              icon={<LogIn size={16} aria-hidden="true" />}
              loading={login.state.phase === 'starting'}
              onClick={() => void login.start()}
            >
              ChatGPT로 연결
            </Button>
          </>
        )}
      </StepActions>
      <p className="text-fg-tertiary type-small">
        <Link to="/settings/ai">설정 &gt; AI</Link>에서 연결 상태와 사용량을 볼 수 있어요.
      </p>
    </div>
  );
}

function StartStep({
  heading,
  onBack,
  finishing,
  onFinish,
}: {
  heading: Heading;
  onBack: (() => void) | undefined;
  finishing: boolean;
  onFinish: (to: { lessonId: string } | null) => void;
}) {
  const plan = useQuery(dailyPlanQuery);
  const blocks = plan.data?.blocks ?? [];
  const lesson = blocks.find((b) => b.lesson !== null)?.lesson ?? null;
  return (
    <div className="grid gap-6">
      {heading('시작할 준비가 됐어요')}
      {plan.isPending ? (
        <Skeleton height={160} />
      ) : (
        <>
          {lesson && (
            <section className="onboarding__first" aria-labelledby="first-lesson">
              <p className="text-fg-secondary type-small">첫 단원</p>
              <h2 id="first-lesson" className="type-h3 text-heading">
                {lesson.title}
              </h2>
            </section>
          )}
          {plan.data && blocks.length > 0 && (
            <section aria-labelledby="today-preview" className="grid gap-2">
              <h2 id="today-preview" className="font-bold text-heading">
                오늘의 학습 · 약 {formatMinutes(plan.data.totalMinutes)}
              </h2>
              <ol className="onboarding__plan">
                {blocks.map((b, i) => (
                  <li key={`${b.kind}-${String(i)}`}>
                    <span className="text-fg">{blockTitle(b)}</span>
                    <span className="tnum text-fg-tertiary type-small">{b.minutes}분</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {!lesson && (
            <p className="text-fg-secondary">대시보드에서 오늘의 학습을 확인하고 시작해 보세요.</p>
          )}
        </>
      )}
      <StepActions onBack={onBack}>
        <Button
          loading={finishing && !lesson}
          onClick={() => {
            onFinish(null);
          }}
        >
          대시보드로
        </Button>
        {lesson && (
          <Button
            variant="primary"
            loading={finishing}
            icon={<ArrowRight size={16} aria-hidden="true" />}
            onClick={() => {
              onFinish({ lessonId: lesson.id });
            }}
          >
            첫 단원 시작
          </Button>
        )}
      </StepActions>
    </div>
  );
}
