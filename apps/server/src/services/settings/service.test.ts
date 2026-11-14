import { describe, expect, it } from 'vitest';
import { ensureLearner } from '../../db/user/learners.ts';
import { settings } from '../../db/user/schema.ts';
import { setupDb, silentLog } from '../../test/helpers.ts';
import { SettingsService } from './service.ts';

describe('SettingsService', () => {
  it('returns defaults, then stored values', async () => {
    const { userDb } = await setupDb();
    const service = new SettingsService({ userDb, log: silentLog });
    expect(service.get()).toEqual({ theme: 'system' });
    expect(service.update({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(service.update({ theme: 'light' })).toEqual({ theme: 'light' }); // upsert
  });

  it('falls back to the default for an invalid stored value and ignores unknown keys', async () => {
    const { userDb } = await setupDb();
    const learner = ensureLearner(userDb);
    userDb.orm
      .insert(settings)
      .values([
        { learnerId: learner.id, key: 'theme', valueJson: 'neon', updatedAt: new Date() },
        { learnerId: learner.id, key: 'future.key', valueJson: 1, updatedAt: new Date() },
      ])
      .run();
    expect(new SettingsService({ userDb, log: silentLog }).get()).toEqual({ theme: 'system' });
  });
});
