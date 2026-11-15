import {
  dashboardSchema,
  reviewQueueSchema,
  exerciseViewSchema,
  heartbeatResponseSchema,
  hintResponseSchema,
  inlineAttemptResponseSchema,
  lessonProgressSchema,
  practiceSetViewSchema,
  reportResponseSchema,
  runPlanSchema,
  skipItemResponseSchema,
  submitAttemptResponseSchema,
  solutionResponseSchema,
  type AttemptRequest,
  type CreatePracticeSetRequest,
  type HeartbeatRequest,
  type InlineAttemptRequest,
  type LessonProgressRequest,
  type ReportRequest,
  type RunPlanRequest,
  backupListSchema,
  backupCheckSchema,
  backupLocationChangeSchema,
  backupLocationSchema,
  resetResponseSchema,
  RESET_CONFIRM_TEXT,
  courseDetailSchema,
  courseListSchema,
  lessonDetailSchema,
  backupSummarySchema,
  settingsResponseSchema,
  type SettingsPatch,
  dailyPlanSchema,
  goalStatusSchema,
  learnerProfileSchema,
  conceptDetailSchema,
  masteryOverviewSchema,
  weakConceptsSchema,
  masteryChangesSchema,
  mistakeDetailSchema,
  mistakeListSchema,
  type MistakeListQuery,
  type GoalRequest,
  type LearnerPatch,
} from '@proginone/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client.ts';

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: ({ signal }) => api('/settings', { schema: settingsResponseSchema, signal }),
  staleTime: Infinity,
});

export function useSettings() {
  return useQuery(settingsQuery);
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      api('/settings', { method: 'PATCH', body: patch, schema: settingsResponseSchema }),
    onSuccess: (settings) => {
      client.setQueryData(settingsQuery.queryKey, settings);
    },
  });
}

export const backupsQuery = queryOptions({
  queryKey: ['backups'],
  queryFn: ({ signal }) => api('/backups', { schema: backupListSchema, signal }),
});

export function useBackups() {
  return useQuery(backupsQuery);
}

export function useCreateBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api('/backups', { method: 'POST', schema: backupSummarySchema }),
    onSuccess: () => client.invalidateQueries({ queryKey: backupsQuery.queryKey }),
  });
}

export function useRestoreBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/backups/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
        schema: z.object({ restored: backupSummarySchema }),
      }),
    // Every cached server state may have changed (docs/design/data-model.md#복원-절차). Reset,
    // not invalidate: some queries are cached as static (the learner profile).
    onSuccess: () => client.resetQueries(),
  });
}

/** Pre-restore check shown in the restore dialog (data-model.md#복원-절차 step 1). */
export const backupCheckQuery = (id: string) =>
  queryOptions({
    queryKey: ['backups', id, 'check'],
    queryFn: ({ signal }) =>
      api(`/backups/${encodeURIComponent(id)}/check`, { schema: backupCheckSchema, signal }),
    staleTime: 0,
    gcTime: 0,
  });

export const backupLocationQuery = queryOptions({
  queryKey: ['backups', 'location'],
  queryFn: ({ signal }) => api('/backups/location', { schema: backupLocationSchema, signal }),
});

export function useChangeBackupLocation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api('/backups/location', {
        method: 'PUT',
        body: { path },
        schema: backupLocationChangeSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['backups'] }),
  });
}

/** `POST /data/reset`; afterwards every cached query is stale (FR-SET-07). */
export function useResetLearningData() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/data/reset', {
        method: 'POST',
        body: { confirm: RESET_CONFIRM_TEXT },
        schema: resetResponseSchema,
      }),
    onSuccess: () => client.resetQueries(),
  });
}

export const coursesQuery = queryOptions({
  queryKey: ['courses'],
  queryFn: ({ signal }) => api('/courses', { schema: courseListSchema, signal }),
  staleTime: Infinity, // content.db only changes with an app restart
});

export const courseQuery = (id: string) =>
  queryOptions({
    queryKey: ['courses', id],
    queryFn: ({ signal }) =>
      api(`/courses/${encodeURIComponent(id)}`, { schema: courseDetailSchema, signal }),
    staleTime: Infinity,
  });

export const lessonQuery = (id: string) =>
  queryOptions({
    queryKey: ['lessons', id],
    queryFn: ({ signal }) =>
      api(`/lessons/${encodeURIComponent(id)}`, { schema: lessonDetailSchema, signal }),
    staleTime: Infinity,
  });

// ── Practice (docs/design/system-architecture.md#api-규약) ──

export const practiceSetQuery = (id: string) =>
  queryOptions({
    queryKey: ['practice-sets', id],
    queryFn: ({ signal }) =>
      api(`/practice-sets/${encodeURIComponent(id)}`, { schema: practiceSetViewSchema, signal }),
  });

/** The exercise as shown in a practice set item (hint ladder state is per item). */
export const exerciseQuery = (id: string, practiceSetItemId: string | null) =>
  queryOptions({
    queryKey: ['exercises', id, practiceSetItemId],
    queryFn: ({ signal }) =>
      api(
        `/exercises/${encodeURIComponent(id)}${
          practiceSetItemId === null
            ? ''
            : `?practiceSetItemId=${encodeURIComponent(practiceSetItemId)}`
        }`,
        { schema: exerciseViewSchema, signal },
      ),
    staleTime: Infinity,
  });

export const createPracticeSet = (request: CreatePracticeSetRequest) =>
  api('/practice-sets', { method: 'POST', body: request, schema: practiceSetViewSchema });

export const fetchRunPlan = (exerciseId: string, request: RunPlanRequest) =>
  api(`/exercises/${encodeURIComponent(exerciseId)}/run-plan`, {
    method: 'POST',
    body: request,
    schema: runPlanSchema,
  });

/** `POST /attempts`. Items of an assessment in progress answer with the withheld shape. */
export const submitAttempt = (request: AttemptRequest) =>
  api('/attempts', { method: 'POST', body: request, schema: submitAttemptResponseSchema });

/** `POST /practice-sets/:id/items/:itemId/skip` (a follow-up of another type is appended). */
export const skipItem = (setId: string, itemId: string) =>
  api(`/practice-sets/${encodeURIComponent(setId)}/items/${encodeURIComponent(itemId)}/skip`, {
    method: 'POST',
    schema: skipItemResponseSchema,
  });

export const openHint = (exerciseId: string, practiceSetItemId: string | null) =>
  api(`/exercises/${encodeURIComponent(exerciseId)}/hints`, {
    method: 'POST',
    body: practiceSetItemId === null ? {} : { practiceSetItemId },
    schema: hintResponseSchema,
  });

export const viewSolution = (exerciseId: string, practiceSetItemId: string | null) =>
  api(`/exercises/${encodeURIComponent(exerciseId)}/solution`, {
    method: 'POST',
    body: practiceSetItemId === null ? {} : { practiceSetItemId },
    schema: solutionResponseSchema,
  });

export const reportExercise = (exerciseId: string, request: ReportRequest) =>
  api(`/exercises/${encodeURIComponent(exerciseId)}/reports`, {
    method: 'POST',
    body: request,
    schema: reportResponseSchema,
  });

/** Inline check in the lesson body (outside any practice set). */
export const submitInlineAttempt = (exerciseId: string, request: InlineAttemptRequest) =>
  api(`/exercises/${encodeURIComponent(exerciseId)}/inline-attempts`, {
    method: 'POST',
    body: request,
    schema: inlineAttemptResponseSchema,
  });

// ── Reading progress and activity ──

export const recordLessonProgress = (lessonId: string, request: LessonProgressRequest) =>
  api(`/lessons/${encodeURIComponent(lessonId)}/progress`, {
    method: 'POST',
    body: request,
    schema: lessonProgressSchema,
  });

export const sendHeartbeat = (request: HeartbeatRequest) =>
  api('/activity/heartbeat', { method: 'POST', body: request, schema: heartbeatResponseSchema });

// ── Dashboard and review ──

export const dashboardQuery = queryOptions({
  queryKey: ['dashboard'],
  queryFn: ({ signal }) => api('/dashboard', { schema: dashboardSchema, signal }),
  staleTime: 30_000,
});

export const reviewQueueQuery = queryOptions({
  queryKey: ['review-queue'],
  queryFn: ({ signal }) => api('/review-queue', { schema: reviewQueueSchema, signal }),
});

// ── Learner profile (onboarding) and goals ──

export const learnerQuery = queryOptions({
  queryKey: ['learner'],
  queryFn: ({ signal }) => api('/learner', { schema: learnerProfileSchema, signal }),
  staleTime: Infinity,
});

export function useUpdateLearner() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: LearnerPatch) =>
      api('/learner', { method: 'PATCH', body: patch, schema: learnerProfileSchema }),
    onSuccess: (learner) => {
      client.setQueryData(learnerQuery.queryKey, learner);
    },
  });
}

export const goalsQuery = queryOptions({
  queryKey: ['goals'],
  queryFn: ({ signal }) => api('/goals', { schema: goalStatusSchema, signal }),
  staleTime: 30_000,
});

export function useSaveGoal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (goal: GoalRequest) =>
      api('/goals', { method: 'PUT', body: goal, schema: goalStatusSchema }),
    onSuccess: (status) => {
      client.setQueryData(goalsQuery.queryKey, status);
      // Today's plan and pace follow the goal.
      void client.invalidateQueries({ queryKey: ['daily-plan'] });
    },
  });
}

export const dailyPlanQuery = queryOptions({
  queryKey: ['daily-plan'],
  queryFn: ({ signal }) => api('/daily-plan', { schema: dailyPlanSchema, signal }),
  staleTime: 30_000,
});

export const masteryQuery = queryOptions({
  queryKey: ['mastery'],
  queryFn: ({ signal }) => api('/mastery', { schema: masteryOverviewSchema, signal }),
  staleTime: 30_000,
});

export const weakConceptsQuery = queryOptions({
  queryKey: ['weak-concepts'],
  queryFn: ({ signal }) => api('/weak-concepts', { schema: weakConceptsSchema, signal }),
  staleTime: 30_000,
});

export const conceptQuery = (id: string, evidenceLimit?: number) =>
  queryOptions({
    queryKey: ['concepts', id, evidenceLimit ?? null],
    queryFn: ({ signal }) =>
      api(
        `/concepts/${encodeURIComponent(id)}${
          evidenceLimit === undefined ? '' : `?evidenceLimit=${String(evidenceLimit)}`
        }`,
        { schema: conceptDetailSchema, signal },
      ),
    staleTime: 30_000,
  });

// ── Review screen: mistake notes and mastery changes ──

/** `GET /mistakes` with only the filters that are set (stable keys for the cache). */
export const mistakesQuery = (query: MistakeListQuery) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query) as [string, string | number | undefined][]) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return queryOptions({
    queryKey: ['mistakes', 'list', search],
    queryFn: ({ signal }) =>
      api(`/mistakes${search ? `?${search}` : ''}`, { schema: mistakeListSchema, signal }),
    staleTime: 30_000,
  });
};

export const mistakeQuery = (exerciseId: string) =>
  queryOptions({
    queryKey: ['mistakes', 'detail', exerciseId],
    queryFn: ({ signal }) =>
      api(`/mistakes/${encodeURIComponent(exerciseId)}`, { schema: mistakeDetailSchema, signal }),
    staleTime: 30_000,
  });

export const masteryChangesQuery = queryOptions({
  queryKey: ['mastery-changes'],
  queryFn: ({ signal }) => api('/mastery-changes', { schema: masteryChangesSchema, signal }),
  staleTime: 30_000,
});

/** Learning state shown on the dashboard, refreshed after attempts and finished sets. */
export const LEARNING_STATE_KEYS = [
  ['dashboard'],
  ['review-queue'],
  ['daily-plan'],
  ['goals'],
  ['mastery'],
  ['weak-concepts'],
  ['concepts'],
  ['mistakes'],
  ['mastery-changes'],
] as const;
