import type { BackupKind } from '@proginone/shared';

export const KIND_LABELS: Record<BackupKind, string> = {
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
  if (bytes < 1024) return `${String(bytes)}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

/** `0005_session_summaries` → `DB 0005`; a backup of an empty database has no migration. */
export const formatSchema = (tag: string | null) => (tag ? `DB ${tag.slice(0, 4)}` : 'DB 없음');
