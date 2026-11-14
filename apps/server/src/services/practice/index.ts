import type { EngineDeps } from '@proginone/learning-engine';
import type { UserDb } from '../../db/user/connection.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { AttemptService } from './attempt-service.ts';
import { ExerciseService } from './exercise-service.ts';
import { PracticeSetService } from './practice-set-service.ts';

export interface PracticeDeps {
  userDb: UserDb;
  content: ContentAccess;
  /** Created once at startup with `createEngine()`. */
  engine: EngineDeps;
  now: Clock;
}

/** Services behind the practice API, created once at startup. */
export interface PracticeServices {
  exercises: ExerciseService;
  sets: PracticeSetService;
  attempts: AttemptService;
}

export function createPracticeServices(deps: PracticeDeps): PracticeServices {
  return {
    exercises: new ExerciseService(deps),
    sets: new PracticeSetService(deps),
    attempts: new AttemptService(deps),
  };
}
