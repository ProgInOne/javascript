import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// user.db schema. Source of truth for columns: docs/design/data-model.md#userdb-설계.
// Times are epoch milliseconds (UTC); calendar dates are local YYYY-MM-DD text.

export const EXPERIENCE_LEVELS = ['none', 'some', 'basics'] as const;

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const learners = sqliteTable(
  'learners',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name'),
    timezone: text('timezone').notNull(),
    dayStartHour: integer('day_start_hour').notNull().default(4),
    experienceLevel: text('experience_level', { enum: EXPERIENCE_LEVELS })
      .notNull()
      .default('none'),
    onboardedAt: integer('onboarded_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check('learners_day_start_hour', sql`${t.dayStartHour} BETWEEN 0 AND 23`),
    check('learners_experience_level', sql`${t.experienceLevel} IN ('none', 'some', 'basics')`),
  ],
);

export const settings = sqliteTable(
  'settings',
  {
    learnerId: text('learner_id')
      .notNull()
      .references(() => learners.id),
    key: text('key').notNull(),
    valueJson: text('value_json', { mode: 'json' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.key] }),
    check('settings_value_json', sql`json_valid(${t.valueJson})`),
  ],
);
