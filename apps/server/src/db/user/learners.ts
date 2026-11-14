import { monotonicFactory } from 'ulid';
import type { UserDb } from './connection.ts';
import { learners } from './schema.ts';

export const newId = monotonicFactory();

export type Learner = typeof learners.$inferSelect;

/** MVP has a single learner; create it on first start with the system time zone. */
export function ensureLearner(userDb: UserDb, now = new Date()): Learner {
  const existing = userDb.orm.select().from(learners).limit(1).get();
  if (existing) return existing;
  const learner = {
    id: newId(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    createdAt: now,
  };
  return userDb.orm.insert(learners).values(learner).returning().get();
}
