import { isCloudSyncedPath, type BackupLocation } from '@proginone/shared';
import { Button, Dialog, Input, useToast } from '@proginone/ui';
import { TriangleAlert } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useChangeBackupLocation } from '../../api/queries.ts';

/** Backups contain tutor conversations (system-architecture.md#개인정보). */
export function CloudNotice() {
  return (
    <p className="m-0 flex items-start gap-2 rounded-md border border-(--color-warning-border) bg-(--color-warning-bg) p-3 text-(--color-warning-fg)">
      <TriangleAlert size={16} className="mt-1 shrink-0" aria-hidden="true" />
      <span>
        클라우드 동기화 폴더 같아요. 백업에는 AI 튜터와 나눈 대화 원문이 포함돼요. 동기화 서비스에도
        함께 올라간다는 점을 알아 두세요.
      </span>
    </p>
  );
}

/**
 * Backup folder change (data-model.md#백업-위치-변경, D-045). A browser cannot open a native
 * folder picker for a local server, so the learner types the path; the server validates it.
 */
export function LocationDialog({
  location,
  trigger,
  onChanged,
}: {
  location: BackupLocation;
  /** The [변경] button; focus returns to it when the dialog closes. */
  trigger: ReactElement;
  onChanged: (previousPath: string) => void;
}) {
  const change = useChangeBackupLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(location.path);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError(null);
    change.mutate(path, {
      onSuccess: (result) => {
        setOpen(false);
        onChanged(result.previousPath);
        toast({ title: '백업 위치를 바꿨어요', variant: 'success' });
      },
      onError: (err) => {
        setError(err.message);
      },
    });
  };

  return (
    <Dialog
      open={open}
      trigger={trigger}
      onOpenChange={(next) => {
        if (change.isPending) return;
        if (next) {
          setPath(location.path);
          setError(null);
        }
        setOpen(next);
      }}
      title="백업 위치 바꾸기"
      description="새 백업을 저장할 폴더의 전체 경로를 입력하세요. 지금까지의 백업은 원래 위치에 그대로 남아요."
      footer={
        <>
          <Button
            disabled={change.isPending}
            onClick={() => {
              setOpen(false);
            }}
          >
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="backup-location-form"
            loading={change.isPending}
            disabled={path.trim() === ''}
          >
            바꾸기
          </Button>
        </>
      }
    >
      <form id="backup-location-form" className="grid gap-3" onSubmit={submit}>
        <Input
          label="폴더 경로"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
          }}
          spellCheck={false}
          autoComplete="off"
          hint="비어 있는 폴더, 기존 ProgInOne 백업 폴더, 또는 이미 있는 폴더 안의 새 폴더 이름. ~ 는 홈 폴더예요."
          error={error ?? undefined}
        />
        {isCloudSyncedPath(path) && <CloudNotice />}
        <p className="m-0 text-fg-secondary type-small">
          바꾸면 새 위치에 바로 백업을 하나 만들어 쓸 수 있는지 확인해요. 기본 위치:{' '}
          <code className="break-all">{location.defaultPath}</code>
        </p>
      </form>
    </Dialog>
  );
}
