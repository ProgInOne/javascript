import { Button, ErrorState } from '@proginone/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { ApiRequestError } from '../api/client.ts';
import { reportClientError } from '../lib/client-errors.ts';
import { isStaleBuildError, reloadForNewBuild } from '../lib/stale-build.ts';

/** Page-level error (docs/design/ui-ux.md#공통-상태-디자인). Maintenance gets its own copy. */
export function AppError({ error, reset }: ErrorComponentProps) {
  const client = useQueryClient();
  const api = error instanceof ApiRequestError ? error : null;
  const staleBuild = isStaleBuildError(error);
  useEffect(() => {
    // A screen chunk from an older build: reload once to pick up the new build (not a bug to report).
    if (staleBuild) {
      reloadForNewBuild();
      return;
    }
    reportClientError('boundary', error);
  }, [error, staleBuild]);
  const retry = () => {
    void client.resetQueries().then(reset);
  };

  if (staleBuild) {
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title="앱이 새 버전으로 바뀌었어요"
        description="이 화면은 이전 버전으로 열려 있어요. 새로고침하면 새 버전으로 이어서 할 수 있어요."
        code="STALE_BUILD"
        action={
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            새로고침
          </Button>
        }
      />
    );
  }
  if (api?.code === 'MAINTENANCE') {
    return (
      <ErrorState
        variant="page"
        headingLevel={1}
        title="데이터를 정리하고 있어요"
        description="백업 복원 같은 작업이 끝나면 다시 쓸 수 있어요. 잠시 후 다시 시도해 주세요."
        code={api.code}
        action={<Button onClick={retry}>다시 시도</Button>}
      />
    );
  }
  return (
    <ErrorState
      variant="page"
      headingLevel={1}
      title={api?.code === 'NETWORK' ? '서버에 연결할 수 없어요' : '화면을 표시하지 못했어요'}
      description={
        api?.message ?? '잠시 후 다시 시도해 주세요. 문제가 계속되면 앱을 다시 시작해 주세요.'
      }
      code={api?.code ?? 'INTERNAL'}
      action={
        <Button variant="primary" onClick={retry}>
          다시 시도
        </Button>
      }
    />
  );
}
