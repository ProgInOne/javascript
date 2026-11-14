import { settingsPatchSchema } from '@proginone/shared';
import { Hono } from 'hono';
import type { SettingsService } from '../../services/settings/service.ts';
import type { AppEnv } from '../env.ts';

export function settingsRoutes(service: SettingsService) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json(service.get()))
    .patch('/', async (c) => {
      const patch = settingsPatchSchema.parse(await c.req.json());
      return c.json(service.update(patch));
    });
}
