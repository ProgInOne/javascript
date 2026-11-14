import type { LearnerPatch, LearnerProfile } from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import {
  ensureLearner,
  hasLearningRecords,
  updateLearner,
  type Learner,
} from '../../db/user/learners.ts';
import type { Clock } from '../clock.ts';

/**
 * `GET/PATCH /learner`: onboarding answers (ui-ux.md#온보딩과-목표-설정). The goal itself is
 * saved with `PUT /goals`; this only keeps the experience level and whether onboarding is done.
 */
export class LearnerService {
  readonly #userDb: UserDb;
  readonly #now: Clock;

  constructor(deps: { userDb: UserDb; now: Clock }) {
    this.#userDb = deps.userDb;
    this.#now = deps.now;
  }

  get(): LearnerProfile {
    return this.#view(ensureLearner(this.#userDb));
  }

  update(patch: LearnerPatch): LearnerProfile {
    const learner = ensureLearner(this.#userDb);
    const values: Parameters<typeof updateLearner>[2] = {};
    if (patch.experienceLevel !== undefined) values.experienceLevel = patch.experienceLevel;
    // Completing twice keeps the first time.
    if (patch.onboarded && learner.onboardedAt === null) values.onboardedAt = new Date(this.#now());
    if (Object.keys(values).length === 0) return this.#view(learner);
    return this.#view(updateLearner(this.#userDb, learner.id, values));
  }

  #view(learner: Learner): LearnerProfile {
    const onboardedAt = learner.onboardedAt?.getTime() ?? null;
    return {
      experienceLevel: learner.experienceLevel,
      onboardedAt,
      needsOnboarding: onboardedAt === null && !hasLearningRecords(this.#userDb, learner.id),
    };
  }
}
