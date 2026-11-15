import { ariaShortcut, Kbd, modKeyLabel } from '@proginone/exercise-ui';
import type { AssessmentResult, LessonDetail, PracticeSetView } from '@proginone/shared';
import { Badge, Button, EmptyState, ErrorState, Tooltip } from '@proginone/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  BookOpen,
  Check,
  ClipboardCheck,
  Lock,
  MessageCircle,
  Minus,
  RotateCcw,
  Target,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { createPracticeSet, practiceSetQuery } from '../../api/queries.ts';
import { useStartSet } from '../dashboard/useStartSet.ts';
import { Markdown } from '../practice/Markdown.tsx';
import { TYPE_LABELS } from '../practice/model.ts';
import { SolutionContent } from '../practice/parts.tsx';
import { formatMinutes } from '../../lib/format.ts';

// Unit assessment screens (learning-engine.md#단원-평가-세트, ui-ux.md 피드백 타이밍):
// the start screen with the rules, the locked tutor button, and the end screen.

const percent = (n: number) => `${Math.round(n * 100)}%`;

/** The rules announced before the assessment starts (D-023, D-042). */
export const ASSESSMENT_RULES: readonly string[] = [
  '힌트, AI 튜터, 정답 보기를 쓸 수 없어요.',
  '문항마다 한 번만 제출할 수 있어요. 제출한 답은 고칠 수 없어요.',
  '정답과 해설은 평가가 끝나면 한꺼번에 보여 줘요.',
  '확신도는 평소처럼 솔직하게 골라 주세요. 실력을 정확히 재는 데 쓰여요.',
  '모르는 문항은 건너뛸 수 있지만, 건너뛴 문항은 틀린 것으로 세요.',
];

/** Start screen: what the assessment covers and its rules, then "평가 시작". */
export function AssessmentStart({
  lesson,
  onStarted,
}: {
  lesson: LessonDetail;
  /** The created (or resumed) set; the caller moves the URL to it. */
  onStarted: (set: PracticeSetView) => void;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rulesId = useId();
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const info = lesson.assessment ?? null;

  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const set = await createPracticeSet({ kind: 'assessment', lessonId: lesson.id });
      client.setQueryData(practiceSetQuery(set.id).queryKey, set);
      onStarted(set);
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e
          : new ApiRequestError('INTERNAL', '평가를 준비하지 못했어요.', 0, true),
      );
      setPending(false);
    }
  };

  if (error?.code === 'PRACTICE_NO_EXERCISES' || info?.itemCount === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        headingLevel={1}
        title="이 단원 평가에는 아직 문항이 없어요"
        description="문항이 준비되면 여기서 평가를 볼 수 있어요."
        action={
          <Link to="/learn/$lessonId" params={{ lessonId: lesson.id }} search={{}}>
            본문 보기
          </Link>
        }
      />
    );
  }

  return (
    <section className="assessment-start" aria-labelledby="assessment-start-title">
      <p className="text-fg-tertiary type-small">{lesson.module.title} · 단원 평가</p>
      <h1
        id="assessment-start-title"
        ref={headingRef}
        tabIndex={-1}
        className="assessment-start__title"
      >
        <ClipboardCheck size={24} aria-hidden="true" />
        {lesson.title}
      </h1>
      {info && (
        <dl className="assessment-start__facts">
          <div>
            <dt>문항</dt>
            <dd>{info.itemCount}문항</dd>
          </div>
          <div>
            <dt>다루는 개념</dt>
            <dd>{info.conceptCount}개</dd>
          </div>
          <div>
            <dt>통과 기준</dt>
            <dd>정답 {percent(info.passRatio)} 이상</dd>
          </div>
          <div>
            <dt>예상 시간</dt>
            <dd>약 {formatMinutes(info.estimatedMinutes)}</dd>
          </div>
        </dl>
      )}
      <h2 id={rulesId} className="assessment-start__subtitle">
        평가 규칙
      </h2>
      <ul className="assessment-start__rules" aria-labelledby={rulesId}>
        {ASSESSMENT_RULES.map((rule) => (
          <li key={rule}>
            <Lock size={14} aria-hidden="true" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>
      <p className="text-fg-secondary type-small">
        평가에서 맞힌 문제는 혼자 힘으로 푼 증거라 숙련도에 조금 더 크게 반영돼요. 통과하지 못해도
        다음 단원은 그대로 열려 있어요.
      </p>
      {error && (
        <p role="alert" className="practice-error">
          {error.message}
        </p>
      )}
      <div className="assessment-start__actions">
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: lesson.id }}
          search={{}}
          className="pi-button pi-button--secondary pi-button--md no-underline"
        >
          요점 다시 보기
        </Link>
        <Button
          variant="primary"
          loading={pending}
          icon={<ArrowRight size={16} aria-hidden="true" />}
          onClick={() => void start()}
        >
          평가 시작
        </Button>
      </div>
    </section>
  );
}

/**
 * The tutor button during an assessment: visible but locked, with the reason as text for screen
 * readers and a tooltip (ui-ux.md: "비활성 + 평가가 끝나면 열려요").
 */
export function LockedTutorButton() {
  const reasonId = useId();
  return (
    <>
      <Tooltip content="평가가 끝나면 열려요">
        <Button
          className="tutor-trigger"
          size="sm"
          variant="ghost"
          aria-disabled="true"
          aria-describedby={reasonId}
          aria-keyshortcuts={ariaShortcut('J')}
          icon={<MessageCircle size={16} aria-hidden="true" />}
          onClick={(e) => {
            e.preventDefault();
          }}
        >
          튜터
          <Lock size={12} aria-hidden="true" />
          <Kbd keys={[modKeyLabel(), 'J']} />
        </Button>
      </Tooltip>
      <span id={reasonId} className="sr-only">
        단원 평가 중에는 튜터를 쓸 수 없어요. 평가가 끝나면 열려요.
      </span>
    </>
  );
}

const OUTCOME = {
  correct: { label: '정답', Icon: Check, variant: 'success' },
  wrong: { label: '오답', Icon: X, variant: 'error' },
  skipped: { label: '건너뜀', Icon: Minus, variant: 'neutral' },
} as const;

function outcomeOf(item: AssessmentResult['items'][number]): keyof typeof OUTCOME {
  if (item.status === 'skipped') return 'skipped';
  return item.correct ? 'correct' : 'wrong';
}

/**
 * End screen: the score against the pass bar, concepts, a weakness set for missed concepts, and
 * every item with its answer and explanation (revealed only now). Wrong items start open.
 */
export function AssessmentResultView({
  lesson,
  set,
  onRetake,
}: {
  lesson: LessonDetail;
  set: PracticeSetView;
  onRetake: () => Promise<void>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const weakness = useStartSet();
  const [retaking, setRetaking] = useState(false);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const result = set.result?.assessment;
  if (!result) {
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title="평가 결과를 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요."
        code="INTERNAL"
      />
    );
  }
  const missed = result.missedConcepts;

  return (
    <section className="assessment-result" aria-labelledby="assessment-result-title">
      <p className="text-fg-tertiary type-small">{lesson.title}</p>
      <h1
        id="assessment-result-title"
        ref={headingRef}
        tabIndex={-1}
        className="assessment-result__title"
      >
        {result.passed ? '단원 평가를 통과했어요' : '단원 평가를 마쳤어요'}
      </h1>
      <p className="assessment-result__score">
        <strong>
          {result.total}문항 중 {result.correct}문항 정답
        </strong>{' '}
        ({percent(result.ratio)}) ·{' '}
        <Badge variant={result.passed ? 'success' : 'warning'}>
          {result.passed ? '통과' : '통과 기준 미달'}
        </Badge>{' '}
        <span className="text-fg-secondary">통과 기준 {percent(result.passRatio)}</span>
      </p>
      {!result.passed && (
        <p className="text-fg-secondary">
          아쉬워요. 틀린 개념을 약점 집중으로 연습한 뒤 다시 응시해 보세요. 다음 단원은 그대로 열려
          있어요.
        </p>
      )}

      <div className="assessment-result__block">
        <h2 className="assessment-result__subtitle">개념별 결과</h2>
        <ul className="assessment-result__concepts">
          {result.concepts.map((c) => (
            <li key={c.concept.id} data-missed={c.correct < c.total ? '' : undefined}>
              <span>{c.concept.title}</span>
              <span className="tabular-nums">
                {c.correct} / {c.total}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {missed.length > 0 && (
        <div className="assessment-result__weakness" role="note">
          <Target size={20} aria-hidden="true" />
          <div>
            <p className="m-0 font-semibold text-heading">틀린 개념을 약점 집중으로 연습해요</p>
            <p className="m-0 text-fg-secondary type-small">
              {missed.map((c) => c.title).join(', ')}
            </p>
            {weakness.error && (
              <p role="alert" className="practice-error">
                {weakness.error.message}
              </p>
            )}
          </div>
          <Button
            variant={result.passed ? 'secondary' : 'primary'}
            loading={weakness.pending !== null}
            onClick={() =>
              void weakness.start('weakness', {
                kind: 'weakness',
                conceptIds: result.weaknessConceptIds,
              })
            }
          >
            약점 집중 시작
          </Button>
        </div>
      )}

      <div className="assessment-result__block">
        <h2 className="assessment-result__subtitle">문항별 정답과 해설</h2>
        <ol className="assessment-result__items">
          {result.items.map((item, i) => {
            const state = OUTCOME[outcomeOf(item)];
            return (
              <li key={item.itemId}>
                <details open={!item.correct} className="assessment-item">
                  <summary>
                    <span className="assessment-item__number">문제 {i + 1}</span>
                    <Badge variant={state.variant} icon={<state.Icon size={12} />}>
                      {state.label}
                    </Badge>
                    <span className="text-fg-secondary type-small">
                      {TYPE_LABELS[item.type] ?? item.type}
                      {item.concept && ` · ${item.concept.title}`}
                    </span>
                  </summary>
                  <div className="assessment-item__body">
                    <Markdown text={item.prompt} />
                    {item.solution.kind !== 'none' && (
                      <>
                        <h3 className="assessment-item__label">정답</h3>
                        <SolutionContent solution={item.solution} />
                      </>
                    )}
                    {item.misconceptions.length > 0 && (
                      <p className="text-fg-secondary type-small">
                        고른 답이 가리키는 오개념:{' '}
                        {item.misconceptions.map((m) => m.title).join(', ')}
                      </p>
                    )}
                    <h3 className="assessment-item__label">해설</h3>
                    <Markdown text={item.explanation} />
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="assessment-result__actions">
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: lesson.id }}
          search={{}}
          className="pi-button pi-button--secondary pi-button--md no-underline"
        >
          요점 다시 보기
        </Link>
        <Button
          variant="secondary"
          icon={<RotateCcw size={16} aria-hidden="true" />}
          loading={retaking}
          onClick={() => {
            setRetaking(true);
            void onRetake().finally(() => {
              setRetaking(false);
            });
          }}
        >
          다시 응시
        </Button>
        {result.passed && lesson.next && (
          <Link
            to="/learn/$lessonId"
            params={{ lessonId: lesson.next.id }}
            search={{}}
            className="pi-button pi-button--primary pi-button--md no-underline"
          >
            다음 단원: {lesson.next.title}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
        {result.passed && !lesson.next && (
          <Link to="/" className="pi-button pi-button--primary pi-button--md no-underline">
            대시보드로
          </Link>
        )}
      </div>
    </section>
  );
}
