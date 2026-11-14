import {
  attemptResponseSchema,
  exerciseViewSchema,
  hintResponseSchema,
  practiceSetViewSchema,
  reportResponseSchema,
  runPlanSchema,
  solutionResponseSchema,
  type AttemptRequest,
  type CreatePracticeSetRequest,
  type ReportRequest,
  type RunPlanRequest,
  backupListSchema,
  courseDetailSchema,
  courseListSchema,
  lessonDetailSchema,
  backupSummarySchema,
  settingsSchema,
  type SettingsPatch,
} from '@proginone/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './client.ts';

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: ({ signal }) => api('/settings', { schema: settingsSchema, signal }),
  staleTime: Infinity,
});

export function useSettings() {
  return useQuery(settingsQuery);
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      api('/settings', { method: 'PATCH', body: patch, schema: settingsSchema }),
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
    // Every cached server state may have changed (docs/design/data-model.md#복원-절차).
    onSuccess: () => client.invalidateQueries(),
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

export const submitAttempt = (request: AttemptRequest) =>
  api('/attempts', { method: 'POST', body: request, schema: attemptResponseSchema });

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
