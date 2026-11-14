import type { BackupKind, BackupSummary } from '@proginone/shared';
import { Badge, Button, Dialog, EmptyState, ErrorState, Skeleton, useToast } from '@proginone/ui';
import { createFileRoute } from '@tanstack/react-router';
import { Archive, DatabaseBackup, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useBackups, useCreateBackup, useRestoreBackup } from '../../api/queries.ts';

export const Route = createFileRoute('/settings/data')({
  component: DataSettings,
});

const KIND_LABELS: Record<BackupKind, string> = {
  daily: '일일',
  weekly: '주간',
  'pre-migration': '업데이트 전',
  'pre-restore': '복원 전',
  'pre-reset': '초기화 전',
  manual: '수동',
};

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const formatBackupDate = (iso: string) => dateFormat.format(new Date(iso));

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

/** Backups section of 설정 > 데이터 (docs/design/ui-ux.md#설정, FR-SET-04/05). */
function DataSettings() {
  const backups = useBackups();
  const create = useCreateBackup();
  const restore = useRestoreBackup();
  const toast = useToast();
  const [target, setTarget] = useState<BackupSummary | null>(null);

  const latest = backups.data?.backups[0];

  return (
    <section aria-labelledby="data-title" className="settings-section">
      <h1 id="data-title" className="page-title">
        데이터
      </h1>

      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="section-title">자동 백업</h2>
            <p className="muted">
              {latest
                ? `켜짐 · 마지막 백업 ${formatBackupDate(latest.createdAt)} · 보관 일일 14개 + 주간 8개`
                : '켜짐 · 보관 일일 14개 + 주간 8개'}
            </p>
          </div>
          <Button
            icon={<DatabaseBackup size={16} />}
            loading={create.isPending}
            onClick={() => {
              create.mutate(undefined, {
                onSuccess: () => {
                  toast({ title: '백업을 만들었어요', variant: 'success' });
                },
                onError: (e) => {
                  toast({
                    title: '백업을 만들지 못했어요',
                    description: e.message,
                    variant: 'error',
                  });
                },
              });
            }}
          >
            지금 백업
          </Button>
        </div>

        <h3 id="backup-list-title" className="list-title">
          백업 목록
        </h3>
        {backups.isPending ? (
          <Skeleton variant="text" lines={3} />
        ) : backups.isError ? (
          <ErrorState
            variant="inline"
            title="백업 목록을 불러오지 못했어요"
            description={backups.error.message}
            action={<Button onClick={() => void backups.refetch()}>다시 시도</Button>}
          />
        ) : backups.data.backups.length === 0 ? (
          <EmptyState
            icon={Archive}
            headingLevel={4}
            title="아직 백업이 없어요"
            description="앱을 시작하면 하루에 한 번 자동으로 백업해요."
          />
        ) : (
          <ul className="backup-list" aria-labelledby="backup-list-title">
            {backups.data.backups.map((b) => (
              <li key={b.id} className="backup-list__item">
                <span className="backup-list__date tnum">{formatBackupDate(b.createdAt)}</span>
                <Badge variant={b.kind === 'manual' ? 'brand' : 'neutral'}>
                  {KIND_LABELS[b.kind]}
                </Badge>
                <span className="backup-list__size tnum muted">{formatSize(b.sizeBytes)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw size={16} />}
                  onClick={() => {
                    setTarget(b);
                  }}
                  aria-label={`${formatBackupDate(b.createdAt)} 백업으로 복원`}
                >
                  복원
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !restore.isPending) setTarget(null);
        }}
        title="이 백업으로 복원할까요?"
        description={
          target
            ? `${formatBackupDate(target.createdAt)} 상태로 되돌려요. 그 이후 기록은 사라지지만, 복원 직전 상태를 따로 백업해 둘게요.`
            : undefined
        }
        footer={
          <>
            <Button
              disabled={restore.isPending}
              onClick={() => {
                setTarget(null);
              }}
            >
              취소
            </Button>
            <Button
              variant="danger"
              loading={restore.isPending}
              onClick={() => {
                if (!target) return;
                restore.mutate(target.id, {
                  onSuccess: () => {
                    setTarget(null);
                    toast({ title: '복원했어요', variant: 'success' });
                  },
                  onError: (e) => {
                    setTarget(null);
                    toast({ title: '복원하지 못했어요', description: e.message, variant: 'error' });
                  },
                });
              }}
            >
              복원
            </Button>
          </>
        }
      />
    </section>
  );
}
