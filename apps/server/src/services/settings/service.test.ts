import { SETTINGS_DEFAULTS } from '@proginone/shared';
import { describe, expect, it } from 'vitest';
import { ensureLearner } from '../../db/user/learners.ts';
import { settings } from '../../db/user/schema.ts';
import { setupDb, silentLog } from '../../test/helpers.ts';
import { SettingsService } from './service.ts';

describe('SettingsService', () => {
  it('returns defaults, then stored values', async () => {
    const { userDb } = await setupDb();
    const service = new SettingsService({ userDb, log: silentLog });
    expect(service.get()).toEqual(SETTINGS_DEFAULTS);
    // D-078: a learner who never chose a theme sees the light one; a saved `system` stays.
    expect(service.get().theme).toBe('light');
    expect(service.update({ theme: 'system' }).theme).toBe('system');
    expect(service.get().theme).toBe('system');
    expect(service.update({ theme: 'dark' })).toEqual({ ...SETTINGS_DEFAULTS, theme: 'dark' });
    expect(service.update({ theme: 'light' }).theme).toBe('light'); // upsert
    expect(
      service.update({ 'editor.autocomplete': true, 'hints.policy': 'after-attempt' }),
    ).toEqual({
      ...SETTINGS_DEFAULTS,
      theme: 'light',
      'editor.autocomplete': true,
      'hints.policy': 'after-attempt',
    });
  });

  it('falls back to the default for an invalid stored value and ignores unknown keys', async () => {
    const { userDb } = await setupDb();
    const learner = ensureLearner(userDb);
    userDb.orm
      .insert(settings)
      .values([
        { learnerId: learner.id, key: 'theme', valueJson: 'neon', updatedAt: new Date() },
        { learnerId: learner.id, key: 'future.key', valueJson: 1, updatedAt: new Date() },
        {
          learnerId: learner.id,
          key: 'practice.askConfidence',
          valueJson: 'yes',
          updatedAt: new Date(),
        },
      ])
      .run();
    expect(new SettingsService({ userDb, log: silentLog }).get()).toEqual(SETTINGS_DEFAULTS);
  });
});
