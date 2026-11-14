import { Button, ErrorState, Skeleton } from '@proginone/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiRequestError } from '../api/client.ts';

/** Loading / error wrapper for a page query (docs/design/ui-ux.md#공통-상태-디자인). */
export function QueryState<T>({
  query,
  notFoundTitle,
  children,
}: {
  query: UseQueryResult<T>;
  notFoundTitle: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton variant="card" height={320} />;
  if (query.isError) {
    const e = query.error instanceof ApiRequestError ? query.error : null;
    if (e?.code === 'NOT_FOUND') {
      return (
        <ErrorState
          variant="page"
          headingLevel={1}
          title={notFoundTitle}
          description={e.message}
          code={e.code}
        />
      );
    }
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title={
          e?.code === 'CONTENT_UNAVAILABLE' ? '학습 콘텐츠가 아직 없어요' : '불러오지 못했어요'
        }
        description={e?.message ?? '잠시 후 다시 시도해 주세요.'}
        code={e?.code ?? 'INTERNAL'}
        action={<Button onClick={() => void query.refetch()}>다시 시도</Button>}
      />
    );
  }
  return <>{children(query.data)}</>;
}
