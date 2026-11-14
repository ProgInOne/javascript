import {
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
