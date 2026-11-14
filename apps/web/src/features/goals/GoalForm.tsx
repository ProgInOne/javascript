import type { CourseList, GoalRequest, GoalView } from '@proginone/shared';
import { Checkbox, Input, Select } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { courseQuery } from '../../api/queries.ts';

const PRESET_MINUTES = [15, 30, 45, 60] as const;
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface GoalDraft {
  dailyMinutes: number;
  /** Text of the "직접 입력" field; null while a preset is chosen. */
  customMinutes: string | null;
  weeklyDays: number;
  withTarget: boolean;
  targetCourseId: string;
  targetDate: string;
}

export function draftOf(goal: GoalView, courses: CourseList): GoalDraft {
  const firstCourse = courses.tracks[0]?.courses[0]?.id ?? '';
  const preset = (PRESET_MINUTES as readonly number[]).includes(goal.dailyMinutes);
  return {
    dailyMinutes: goal.dailyMinutes,
    customMinutes: preset ? null : String(goal.dailyMinutes),
    weeklyDays: goal.weeklyDays,
    withTarget: goal.targetCourse !== null,
    targetCourseId: goal.targetCourse?.id ?? firstCourse,
    targetDate: goal.targetDate ?? '',
  };
}

/** The `PUT /goals` body, or an error message per invalid field. */
export function requestOf(
  draft: GoalDraft,
  today: string,
):
  | { ok: true; request: GoalRequest }
  | { ok: false; errors: Partial<Record<'minutes' | 'date', string>> } {
  const errors: Partial<Record<'minutes' | 'date', string>> = {};
  const minutes = draft.customMinutes === null ? draft.dailyMinutes : Number(draft.customMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
    errors.minutes = '5분에서 480분 사이로 정해 주세요.';
  }
  if (draft.withTarget) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.targetDate)) errors.date = '목표일을 골라 주세요.';
    else if (draft.targetDate < today) errors.date = '목표일은 오늘 이후로 정해 주세요.';
  }
  if (errors.minutes || errors.date) return { ok: false, errors };
  return {
    ok: true,
    request: {
      dailyMinutes: minutes,
      weeklyDays: draft.weeklyDays,
      ...(draft.withTarget
        ? { targetCourseId: draft.targetCourseId, targetDate: draft.targetDate }
        : { targetCourseId: null, targetDate: null }),
    },
  };
}

function ChipGroup<T extends number>({
  legend,
  name,
  options,
  value,
  onChange,
  label,
  extra,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T | null;
  onChange: (value: T) => void;
  label: (value: T) => string;
  extra?: ReactNode;
}) {
  return (
    <fieldset className="choice-chips">
      <legend className="choice-chips__legend">{legend}</legend>
      <div className="choice-chips__items">
        {options.map((option) => (
          <label key={option} className="choice-chip">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => {
                onChange(option);
              }}
            />
            <span>{label(option)}</span>
          </label>
        ))}
        {extra}
      </div>
    </fieldset>
  );
}

/**
 * Rough pace for a new course target (onboarding): the course's lesson estimates over the study
 * days until the target date. The server's pace (`GET /goals`) replaces it once the goal is saved;
 * it also counts finished lessons and calibration, which a first-run learner does not have yet.
 */
export function estimatePace(
  totalMinutes: number,
  today: string,
  targetDate: string,
  weeklyDays: number,
): number | null {
  const days = Math.round((Date.parse(targetDate) - Date.parse(today)) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || totalMinutes <= 0) return null;
  const studyDays = Math.max(1, Math.floor((days * weeklyDays) / 7));
  return Math.ceil(totalMinutes / studyDays);
}

function PacePreview({ draft, today }: { draft: GoalDraft; today: string }) {
  const course = useQuery({ ...courseQuery(draft.targetCourseId), enabled: draft.withTarget });
  if (!draft.withTarget || !course.data || !/^\d{4}-\d{2}-\d{2}$/.test(draft.targetDate)) {
    return null;
  }
  const total = course.data.modules
    .flatMap((m) => m.lessons)
    .filter((l) => l.kind === 'lesson')
    .reduce((sum, l) => sum + l.estimatedMinutes, 0);
  const perDay = estimatePace(total, today, draft.targetDate, draft.weeklyDays);
  if (perDay === null) return null;
  const minutes = draft.customMinutes === null ? draft.dailyMinutes : Number(draft.customMinutes);
  const tight = perDay > minutes;
  return (
    <p className="goal-form__pace" data-tight={tight || undefined} role="status">
      {tight
        ? `이 목표일이면 하루 약 ${perDay}분이 필요해요. 조금 빠듯해요. 목표일을 늦추거나 하루 시간을 늘려볼까요?`
        : `이 속도라면 하루 약 ${perDay}분이면 돼요. 하루 ${minutes}분이면 목표일 전에 끝나요.`}
    </p>
  );
}

/**
 * The goal fields (FR-GOAL-01/02, ui-ux.md 온보딩 목표 단계): daily minutes, study days per week
 * and an optional course target date. Shared by the onboarding and 설정 > 학습 목표.
 */
export function GoalFields({
  draft,
  onChange,
  courses,
  today,
  errors,
  showEstimate,
}: {
  draft: GoalDraft;
  onChange: (draft: GoalDraft) => void;
  courses: CourseList;
  today: string;
  errors: Partial<Record<'minutes' | 'date', string>>;
  showEstimate: boolean;
}) {
  const customId = useId();
  const [customFocus, setCustomFocus] = useState(false);
  const courseOptions = courses.tracks.flatMap((t) =>
    t.courses.map((c) => ({ value: c.id, label: c.title })),
  );
  const set = (patch: Partial<GoalDraft>) => {
    onChange({ ...draft, ...patch });
  };
  return (
    <div className="goal-form">
      <ChipGroup
        legend="하루에 얼마나 공부할까요?"
        name={`${customId}-minutes`}
        options={PRESET_MINUTES}
        value={draft.customMinutes === null ? (draft.dailyMinutes as 15) : null}
        onChange={(m) => {
          set({ dailyMinutes: m, customMinutes: null });
        }}
        label={(m) => `${m}분`}
        extra={
          <label className="choice-chip" data-custom="">
            <input
              type="radio"
              name={`${customId}-minutes`}
              checked={draft.customMinutes !== null}
              onChange={() => {
                set({ customMinutes: String(draft.dailyMinutes) });
                setCustomFocus(true);
              }}
            />
            <span>직접 입력</span>
          </label>
        }
      />
      {draft.customMinutes !== null && (
        <div className="max-w-[200px]">
          <Input
            label="하루 공부 시간(분)"
            type="number"
            inputMode="numeric"
            min={5}
            max={480}
            value={draft.customMinutes}
            autoFocus={customFocus}
            error={errors.minutes}
            onChange={(e) => {
              set({ customMinutes: e.target.value });
            }}
          />
        </div>
      )}
      <ChipGroup
        legend="일주일에 며칠 공부할까요?"
        name={`${customId}-days`}
        options={WEEK_DAYS}
        value={draft.weeklyDays as 5}
        onChange={(d) => {
          set({ weeklyDays: d });
        }}
        label={(d) => `${d}일`}
      />
      <div className="grid gap-3">
        <Checkbox
          label="과정을 끝낼 목표일 정하기 (선택)"
          description="정하면 목표일까지 필요한 하루 학습량을 알려 드려요."
          checked={draft.withTarget}
          onCheckedChange={(checked) => {
            set({ withTarget: checked === true });
          }}
        />
        {draft.withTarget && (
          <div className="grid max-w-[560px] gap-4 md:grid-cols-2">
            <Select
              label="과정"
              options={courseOptions}
              value={draft.targetCourseId}
              onValueChange={(v) => {
                set({ targetCourseId: v });
              }}
            />
            <Input
              label="완료 목표일"
              type="date"
              min={today}
              value={draft.targetDate}
              error={errors.date}
              onChange={(e) => {
                set({ targetDate: e.target.value });
              }}
            />
          </div>
        )}
        {showEstimate && <PacePreview draft={draft} today={today} />}
      </div>
    </div>
  );
}
