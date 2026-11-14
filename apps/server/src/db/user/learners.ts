import { eq, sql } from 'drizzle-orm';
import { monotonicFactory } from 'ulid';
import type { UserDb } from './connection.ts';
import { attempts, goals, learners, lessonProgress } from './schema.ts';

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

/** Updates the onboarding answers of a learner. */
export function updateLearner(
  userDb: UserDb,
  id: string,
  values: Partial<Pick<Learner, 'experienceLevel' | 'onboardedAt'>>,
): Learner {
  return userDb.orm.update(learners).set(values).where(eq(learners.id, id)).returning().get();
}

/**
 * True when the learner already has learning records (lesson progress, attempts or a goal).
 * v0.1 learners started before onboarding existed and should not see it after an upgrade.
 */
export function hasLearningRecords(userDb: UserDb, id: string): boolean {
  const any = (table: typeof lessonProgress | typeof attempts | typeof goals) =>
    userDb.orm
      .select({ one: sql<number>`1` })
      .from(table)
      .where(eq(table.learnerId, id))
      .limit(1)
      .get() !== undefined;
  return any(lessonProgress) || any(attempts) || any(goals);
}
