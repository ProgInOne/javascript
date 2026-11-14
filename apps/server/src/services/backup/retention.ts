import type { BackupKind } from '@proginone/shared';

/** How many backups of each kind to keep; null = never delete automatically. */
export const RETENTION: Record<BackupKind, number | null> = {
  daily: 14,
  weekly: 8,
  'pre-migration': 5,
  'pre-restore': 3,
  'pre-reset': 3,
  manual: null,
};

interface Item {
  id: string;
  createdAt: string;
  appVersion: string;
}

/**
 * Returns the ids to delete for one kind. Keeps the newest N; for `pre-migration` also keeps the
 * newest backup made by an older app version than the newest one, so a downgrade path always exists.
 */
export function selectExpired(kind: BackupKind, items: readonly Item[]): string[] {
  const keep = RETENTION[kind];
  if (keep === null) return [];
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = new Set(sorted.slice(0, keep).map((i) => i.id));
  if (kind === 'pre-migration' && sorted[0]) {
    const newestVersion = sorted[0].appVersion;
    const previous = sorted.find((i) => i.appVersion !== newestVersion);
    if (previous) kept.add(previous.id);
  }
  return sorted.filter((i) => !kept.has(i.id)).map((i) => i.id);
}
