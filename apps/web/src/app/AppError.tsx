import { Button, ErrorState } from '@proginone/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { ApiRequestError } from '../api/client.ts';

/** Page-level error (docs/design/ui-ux.md#공통-상태-디자인). Maintenance gets its own copy. */
export function AppError({ error, reset }: ErrorComponentProps) {
  const client = useQueryClient();
  const api = error instanceof ApiRequestError ? error : null;
  const retry = () => {
    void client.resetQueries().then(reset);
  };

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
