import type { BackupCheck, BackupSummary } from '@proginone/shared';
import { Button, Dialog, Spinner, useToast } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { backupCheckQuery, useRestoreBackup } from '../../api/queries.ts';
import { formatBackupDate, formatSchema } from './format.ts';

const PROBLEM_TEXT: Record<NonNullable<BackupCheck['problem']>, string> = {
  checksum: '백업 파일이 만들 때와 달라졌어요. 손상된 백업이라 복원할 수 없어요.',
  integrity: '백업 파일이 손상되어 열 수 없어요. 다른 백업을 골라 주세요.',
  'newer-schema': '더 새로운 버전의 앱에서 만든 백업이에요. 앱을 업데이트한 뒤 복원해 주세요.',
};

/**
 * Restore confirmation (ui-ux.md#설정, data-model.md#복원-절차). The server checks the file
 * first; the restore button stays off until the check passes.
 */
export function RestoreDialog({
  target,
  onClose,
}: {
  target: BackupSummary | null;
  onClose: () => void;
}) {
  const restore = useRestoreBackup();
  const toast = useToast();
  const check = useQuery({
    ...backupCheckQuery(target?.id ?? ''),
    enabled: target !== null,
  });
  const ok = check.data?.ok === true;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !restore.isPending) onClose();
      }}
      title="이 백업으로 복원할까요?"
      description={
        target
          ? `${formatBackupDate(target.createdAt)} 상태로 되돌려요. 그 이후 기록은 사라지지만, 복원 직전 상태를 따로 백업해 둘게요.`
          : undefined
      }
      footer={
        <>
          <Button disabled={restore.isPending} onClick={onClose}>
            취소
          </Button>
          <Button
            variant="danger"
            loading={restore.isPending}
            disabled={!ok}
            onClick={() => {
              if (!target) return;
              restore.mutate(target.id, {
                onSuccess: () => {
                  onClose();
                  toast({ title: '복원했어요', variant: 'success' });
                },
                onError: (e) => {
                  onClose();
                  toast({ title: '복원하지 못했어요', description: e.message, variant: 'error' });
                },
              });
            }}
          >
            복원
          </Button>
        </>
      }
    >
      {target && (
        <div className="grid gap-2">
          <p className="m-0 text-fg-secondary">
            앱 v{target.appVersion} · {formatSchema(target.schemaMigration)}
          </p>
          <div role="status" className="flex items-start gap-2">
            {check.isPending ? (
              <>
                <Spinner />
                <span>백업 파일을 확인하고 있어요…</span>
              </>
            ) : check.isError ? (
              <>
                <CircleAlert
                  size={16}
                  className="mt-1 shrink-0 text-(--color-feedback-incorrect-fg)"
                  aria-hidden="true"
                />
                <span>백업 파일을 확인하지 못했어요. {check.error.message}</span>
              </>
            ) : check.data.ok ? (
              <>
                <CircleCheck
                  size={16}
                  className="mt-1 shrink-0 text-(--color-feedback-correct-fg)"
                  aria-hidden="true"
                />
                <span>
                  파일을 확인했어요. 온전한 백업이에요.
                  {check.data.migrationNeeded &&
                    ' 이전 버전에서 만든 백업이라, 복원한 뒤 데이터 형식을 지금 버전에 맞게 바꿔요.'}
                </span>
              </>
            ) : (
              <>
                <CircleAlert
                  size={16}
                  className="mt-1 shrink-0 text-(--color-feedback-incorrect-fg)"
                  aria-hidden="true"
                />
                <span>{check.data.problem ? PROBLEM_TEXT[check.data.problem] : null}</span>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
