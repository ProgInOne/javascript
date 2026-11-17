import type { LessonDetail, PracticeSetView } from '@proginone/shared';
import { Button, EmptyState, ErrorState, Skeleton } from '@proginone/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, BookOpen, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { createPracticeSet, practiceSetQuery } from '../../api/queries.ts';
import { PracticeSession } from './PracticeSession.tsx';

export interface LessonPracticeProps {
  lesson: LessonDetail;
  setId: string | undefined;
  /** 1-based item from the URL. */
  item: number | undefined;
  /** Updates the URL (`replace` for the initial redirect to the set). */
  navigate: (search: { set: string; i?: number }, replace?: boolean) => void;
}

/** Practice mode of the learning screen: resolves the lesson's set, then runs the session. */
export function LessonPractice({ lesson, setId, item, navigate }: LessonPracticeProps) {
  if (!setId) return <StartLessonSet lesson={lesson} navigate={navigate} />;
  return <LessonSet lesson={lesson} setId={setId} item={item} navigate={navigate} />;
}

/** Creates (or resumes) the lesson set and moves the URL to it. */
function StartLessonSet({ lesson, navigate }: Pick<LessonPracticeProps, 'lesson' | 'navigate'>) {
  const client = useQueryClient();
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (started.current === attempt) return; // StrictMode double effect
    started.current = attempt;
    createPracticeSet({ kind: 'lesson', lessonId: lesson.id })
      .then((set) => {
        client.setQueryData(practiceSetQuery(set.id).queryKey, set);
        const next = set.items.findIndex((i) => i.id === set.nextItemId);
        navigate({ set: set.id, ...(next >= 0 ? { i: next + 1 } : {}) }, true);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e : new Error(String(e)));
      });
  }, [attempt, client, lesson.id, navigate]);

  if (!error) return <Skeleton variant="card" height={360} />;
  const code = error instanceof ApiRequestError ? error.code : 'INTERNAL';
  if (code === 'PRACTICE_NO_EXERCISES') {
    return (
      <EmptyState
        icon={BookOpen}
        headingLevel={1}
        title="이 단원에는 아직 연습 문제가 없어요"
        description="본문을 읽고 예제를 실행해 보세요. 문제가 준비되면 여기서 풀 수 있어요."
        action={
          <Link to="/learn/$lessonId" params={{ lessonId: lesson.id }} search={{}}>
            본문 읽기
          </Link>
        }
      />
    );
  }
  return (
    <ErrorState
      variant="page"
      headingLevel={1}
      title="연습을 준비하지 못했어요"
      description={error.message}
      code={code}
      action={
        <Button
          onClick={() => {
            setError(null);
            setAttempt((a) => a + 1);
          }}
        >
          다시 시도
        </Button>
      }
    />
  );
}

function LessonSet({ lesson, setId, item, navigate }: LessonPracticeProps & { setId: string }) {
  const query = useQuery(practiceSetQuery(setId));
  const client = useQueryClient();
  const [restarting, setRestarting] = useState(false);

  if (query.isPending) return <Skeleton variant="card" height={360} />;
  if (query.isError) {
    const e = query.error instanceof ApiRequestError ? query.error : null;
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title={e?.code === 'NOT_FOUND' ? '연습 세트를 찾을 수 없어요' : '연습을 불러오지 못했어요'}
        description={e?.message ?? '잠시 후 다시 시도해 주세요.'}
        code={e?.code ?? 'INTERNAL'}
        action={
          <Link
            to="/learn/$lessonId"
            params={{ lessonId: lesson.id }}
            search={{ mode: 'practice' }}
          >
            새 연습 시작
          </Link>
        }
      />
    );
  }
  const set = query.data;
  const index = item !== undefined && item >= 1 && item <= set.items.length ? item - 1 : null;

  const again = async () => {
    setRestarting(true);
    try {
      const next = await createPracticeSet({ kind: 'lesson', lessonId: lesson.id });
      client.setQueryData(practiceSetQuery(next.id).queryKey, next);
      navigate({ set: next.id, i: 1 });
    } finally {
      setRestarting(false);
    }
  };

  const project = lesson.kind === 'project';
  const summaryActions = (done: PracticeSetView) => {
    const passed = done.result?.pass?.passed === true;
    if (project) {
      // A project's preparation practice leads back to the project (its milestones complete it).
      return (
        <>
          <Button
            variant="secondary"
            icon={<RotateCcw size={16} aria-hidden="true" />}
            loading={restarting}
            onClick={() => void again()}
          >
            한 번 더 연습
          </Button>
          <Link
            to="/learn/$lessonId"
            params={{ lessonId: lesson.id }}
            search={{ mode: 'practice' }}
            className="pi-button pi-button--primary pi-button--md no-underline"
          >
            프로젝트로 돌아가기
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </>
      );
    }
    return (
      <>
        <Link
          to="/learn/$lessonId"
          params={{ lessonId: lesson.id }}
          search={{}}
          className="pi-button pi-button--secondary pi-button--md no-underline"
        >
          본문 다시 보기
        </Link>
        <Button
          variant={passed ? 'secondary' : 'primary'}
          icon={<RotateCcw size={16} aria-hidden="true" />}
          loading={restarting}
          onClick={() => void again()}
        >
          한 번 더 연습
        </Button>
        {/* Not passing never blocks the next lesson (D-081): the link stays, as a secondary
            action after "한 번 더 연습". */}
        {lesson.next ? (
          <Link
            to="/learn/$lessonId"
            params={{ lessonId: lesson.next.id }}
            search={{}}
            className={`pi-button pi-button--${passed ? 'primary' : 'secondary'} pi-button--md no-underline`}
          >
            {passed ? '다음 단원' : '다음 단원으로'}: {lesson.next.title}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <Link
            to="/"
            className={`pi-button pi-button--${passed ? 'primary' : 'secondary'} pi-button--md no-underline`}
          >
            대시보드로
          </Link>
        )}
      </>
    );
  };

  return (
    <PracticeSession
      set={set}
      index={index}
      onIndexChange={(i) => {
        navigate({ set: set.id, ...(i === null ? {} : { i: i + 1 }) });
      }}
      heading={project ? `${lesson.title} 준비 연습` : `${lesson.title} 연습`}
      lessonTitle={lesson.title}
      summaryActions={summaryActions}
    />
  );
}
