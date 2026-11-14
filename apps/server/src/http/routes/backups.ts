import { backupIdSchema, type BackupSummary } from '@proginone/shared';
import { Hono } from 'hono';
import type { BackupEntry, BackupService } from '../../services/backup/service.ts';
import type { AppEnv } from '../env.ts';

const summary = ({
  id,
  kind,
  createdAt,
  appVersion,
  schemaMigration,
  sizeBytes,
}: BackupEntry): BackupSummary => ({
  id,
  kind,
  createdAt,
  appVersion,
  schemaMigration,
  sizeBytes,
});

export function backupRoutes(backups: BackupService) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json({ backups: backups.list().map(summary) }))
    .post('/', async (c) => c.json(summary(await backups.create('manual')), 201))
    .post('/:id/restore', async (c) => {
      const id = backupIdSchema.parse(c.req.param('id'));
      return c.json({ restored: summary(await backups.restore(id)) });
    });
}
