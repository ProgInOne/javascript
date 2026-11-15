import {
  SETTINGS_DEFAULTS,
  settingsSchema,
  type SettingKey,
  type Settings,
  type SettingsPatch,
} from '@proginone/shared';
import { eq } from 'drizzle-orm';
import type { UserDb } from '../../db/user/connection.ts';
import { ensureLearner } from '../../db/user/learners.ts';
import { settings } from '../../db/user/schema.ts';
import type { Logger } from '../../observability/logger.ts';

const KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof Settings)[];

export class SettingsService {
  readonly #userDb: UserDb;
  readonly #log: Logger;

  constructor(deps: { userDb: UserDb; log: Logger }) {
    this.#userDb = deps.userDb;
    this.#log = deps.log;
  }

  /** Stored values over defaults. A stored value that fails its schema falls back to the default. */
  get(): Settings {
    const learner = ensureLearner(this.#userDb);
    const rows = this.#userDb.orm
      .select()
      .from(settings)
      .where(eq(settings.learnerId, learner.id))
      .all();
    const out: Settings = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      if (!KEYS.includes(row.key as keyof Settings)) continue; // key from a newer app version
      const key = row.key as keyof Settings;
      const parsed = settingsSchema.shape[key].safeParse(row.valueJson);
      if (parsed.success) (out as Record<SettingKey, unknown>)[key] = parsed.data;
      else this.#log.warn({ key, issues: parsed.error.issues }, 'ignoring invalid stored setting');
    }
    return out;
  }

  update(patch: SettingsPatch): Settings {
    const learner = ensureLearner(this.#userDb);
    const now = new Date();
    this.#userDb.orm.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        tx.insert(settings)
          .values({ learnerId: learner.id, key, valueJson: value, updatedAt: now })
          .onConflictDoUpdate({
            target: [settings.learnerId, settings.key],
            set: { valueJson: value, updatedAt: now },
          })
          .run();
      }
    });
    return this.get();
  }
}
