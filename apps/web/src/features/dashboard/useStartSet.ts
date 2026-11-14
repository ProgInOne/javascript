import type { CreatePracticeSetRequest } from '@proginone/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiRequestError } from '../../api/client.ts';
import { createPracticeSet, practiceSetQuery } from '../../api/queries.ts';

/**
 * Starts a review or weakness set and opens it in the set screen (`/review/session/:setId`, the
 * practice layout). Errors are kept for the caller to show next to the button.
 */
export function useStartSet() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const start = async (key: string, request: CreatePracticeSetRequest) => {
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      const set = await createPracticeSet(request);
      client.setQueryData(practiceSetQuery(set.id).queryKey, set);
      const next = set.items.findIndex((i) => i.id === set.nextItemId);
      await navigate({
        to: '/review/session/$setId',
        params: { setId: set.id },
        search: { i: next >= 0 ? next + 1 : 1 },
      });
    } catch (e) {
      setError(
        e instanceof ApiRequestError
          ? e
          : new ApiRequestError('INTERNAL', '연습 세트를 준비하지 못했어요.', 0, true),
      );
    } finally {
      setPending(null);
    }
  };

  return { start, pending, error };
}
