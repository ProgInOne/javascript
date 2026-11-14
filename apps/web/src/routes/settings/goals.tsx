import type { CourseList, GoalStatus } from '@proginone/shared';
import { Button, ErrorState, Skeleton, useToast } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { coursesQuery, goalsQuery, useSaveGoal } from '../../api/queries.ts';
import { cardClass, pageTitleClass } from '../../app/layout.ts';
import { draftOf, GoalFields, requestOf, type GoalDraft } from '../../features/goals/GoalForm.tsx';
import { formatLocalDate, paceText } from '../../features/goals/pace.ts';

export const Route = createFileRoute('/settings/goals')({
  component: GoalSettings,
});

/** 설정 > 학습 목표 (ui-ux.md 사이트맵 /settings/goals, FR-GOAL-01/02). */
function GoalSettings() {
  const goals = useQuery(goalsQuery);
  const courses = useQuery(coursesQuery);
  return (
    <section aria-labelledby="goals-title" className="max-w-[760px]">
      <h1 id="goals-title" className={pageTitleClass}>
        학습 목표
      </h1>
      <div className={cardClass}>
        {goals.isError || courses.isError ? (
          <ErrorState
            variant="inline"
            title="목표를 불러오지 못했어요"
            description={(goals.error ?? courses.error)?.message}
            action={
              <Button
                onClick={() => {
                  void goals.refetch();
                  void courses.refetch();
                }}
              >
                다시 시도
              </Button>
            }
          />
        ) : goals.data && courses.data ? (
          <GoalEditor status={goals.data} courses={courses.data} />
        ) : (
          <Skeleton height={240} />
        )}
      </div>
    </section>
  );
}

function GoalEditor({ status, courses }: { status: GoalStatus; courses: CourseList }) {
  const toast = useToast();
  const save = useSaveGoal();
  const [draft, setDraft] = useState<GoalDraft>(() => draftOf(status.goal, courses));
  const [errors, setErrors] = useState<Partial<Record<'minutes' | 'date', string>>>({});
  const pace = status.pace && paceText(status.pace);

  const submit = () => {
    const result = requestOf(draft, status.date);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.request, {
      onSuccess: () => {
        toast({ title: '목표를 저장했어요', variant: 'success' });
      },
      onError: (e) => {
        toast({ title: '목표를 저장하지 못했어요', description: e.message, variant: 'error' });
      },
    });
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
      {status.goal.targetCourse && status.goal.targetDate && pace && (
        <p className="goal-form__pace" data-tight={pace.attention || undefined}>
          목표일 {formatLocalDate(status.goal.targetDate)} · {status.goal.targetCourse.title} ·{' '}
          {pace.text}
        </p>
      )}
      <GoalFields
        draft={draft}
        onChange={setDraft}
        courses={courses}
        today={status.date}
        errors={errors}
        showEstimate={false}
      />
      <div>
        <Button type="submit" variant="primary" loading={save.isPending}>
          저장
        </Button>
      </div>
    </form>
  );
}
