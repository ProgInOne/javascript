import type { BackupSummary } from '@proginone/shared';
import { Badge, Button, EmptyState, ErrorState, Skeleton, Tooltip, useToast } from '@proginone/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Archive, DatabaseBackup, FolderOpen, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { backupLocationQuery, useBackups, useCreateBackup } from '../../api/queries.ts';
import { cardClass, pageTitleClass } from '../../app/layout.ts';
import {
  formatBackupDate,
  formatSchema,
  formatSize,
  KIND_LABELS,
} from '../../features/data/format.ts';
import { CloudNotice, LocationDialog } from '../../features/data/LocationDialog.tsx';
import { ResetSection } from '../../features/data/ResetSection.tsx';
import { RestoreDialog } from '../../features/data/RestoreDialog.tsx';

export const Route = createFileRoute('/settings/data')({
  component: DataSettings,
});

/** 설정 > 데이터 (docs/design/ui-ux.md#설정, FR-SET-04/05/07). */
function DataSettings() {
  return (
    <section aria-labelledby="data-title" className="max-w-[760px]">
      <h1 id="data-title" className={pageTitleClass}>
        데이터
      </h1>
      <BackupCard />
      <ResetSection />
    </section>
  );
}

function BackupCard() {
  const backups = useBackups();
  const create = useCreateBackup();
  const toast = useToast();
  const [target, setTarget] = useState<BackupSummary | null>(null);

  const latest = backups.data?.backups[0];

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="type-h3 text-heading">자동 백업</h2>
          <p className="text-fg-secondary">
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

      <LocationRow />

      <h3 id="backup-list-title" className="mt-6 mb-2 font-semibold text-fg-secondary type-ui">
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
        <ul className="m-0 list-none p-0" aria-labelledby="backup-list-title">
          {backups.data.backups.map((b) => (
            <li
              key={b.id}
              className="grid grid-cols-[110px_96px_1fr_auto_auto] items-center gap-3 border-t border-line py-2"
            >
              <span className="tabular-nums">{formatBackupDate(b.createdAt)}</span>
              <span>
                <Badge variant={b.kind === 'manual' ? 'brand' : 'neutral'}>
                  {KIND_LABELS[b.kind]}
                </Badge>
              </span>
              <span className="text-fg-tertiary tabular-nums type-small">
                v{b.appVersion} · {formatSchema(b.schemaMigration)}
              </span>
              <span className="justify-self-end text-fg-secondary tabular-nums">
                {formatSize(b.sizeBytes)}
              </span>
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

      <RestoreDialog
        target={target}
        onClose={() => {
          setTarget(null);
        }}
      />
    </div>
  );
}

/** 위치 row: the folder new backups go to, with [변경] (data-model.md#백업-위치-변경). */
function LocationRow() {
  const location = useQuery(backupLocationQuery);
  const [previousPath, setPreviousPath] = useState<string | null>(null);

  if (location.isPending) return <Skeleton variant="text" lines={1} />;
  if (location.isError) {
    return (
      <p className="mt-4 text-fg-secondary">
        백업 위치를 불러오지 못했어요. {location.error.message}
      </p>
    );
  }
  const { data } = location;
  const changeButton = (
    <Button size="sm" icon={<FolderOpen size={16} />} aria-disabled={!data.editable || undefined}>
      변경
    </Button>
  );

  return (
    <div className="mt-4 grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-fg-secondary">위치</span>
        <code className="min-w-0 flex-1 break-all" data-testid="backup-location">
          {data.path}
        </code>
        {data.editable ? (
          <LocationDialog location={data} trigger={changeButton} onChanged={setPreviousPath} />
        ) : (
          <Tooltip content="환경 변수 PROGINONE_BACKUP_DIR로 정해져 있어요">{changeButton}</Tooltip>
        )}
      </div>
      {data.cloudSynced && <CloudNotice />}
      {previousPath && (
        <p role="status" className="m-0 text-fg-secondary type-small">
          이전 위치의 백업은 그대로 남아 있어요: <code className="break-all">{previousPath}</code>
        </p>
      )}
    </div>
  );
}
