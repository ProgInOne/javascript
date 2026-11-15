import { backupIdSchema, backupLocationRequestSchema, resetRequestSchema } from '@proginone/shared';
import { Hono } from 'hono';
import type { BackupLocationService } from '../../services/backup/location.ts';
import { toSummary, type BackupService } from '../../services/backup/service.ts';
import type { DataResetService } from '../../services/data/reset-service.ts';
import type { AppEnv } from '../env.ts';

export function backupRoutes(backups: BackupService, location?: BackupLocationService) {
  const routes = new Hono<AppEnv>()
    .get('/', (c) => c.json({ backups: backups.list().map(toSummary) }))
    .post('/', async (c) => c.json(toSummary(await backups.create('manual')), 201))
    .get('/:id/check', (c) => {
      const id = backupIdSchema.parse(c.req.param('id'));
      return c.json(backups.check(id));
    })
    .post('/:id/restore', async (c) => {
      const id = backupIdSchema.parse(c.req.param('id'));
      return c.json({ restored: toSummary(await backups.restore(id)) });
    });
  if (!location) return routes;
  return routes
    .get('/location', (c) => c.json(location.get()))
    .put('/location', async (c) => {
      const { path } = backupLocationRequestSchema.parse(await c.req.json());
      return c.json(await location.change(path));
    });
}

/** `POST /data/reset` (FR-SET-07). */
export function dataRoutes(reset: DataResetService) {
  return new Hono<AppEnv>().post('/reset', async (c) => {
    resetRequestSchema.parse(await c.req.json());
    return c.json(await reset.reset());
  });
}
