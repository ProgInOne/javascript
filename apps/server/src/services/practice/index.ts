import type { UserDb } from '../../db/user/connection.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { ExerciseService } from './exercise-service.ts';

export interface PracticeDeps {
  userDb: UserDb;
  content: ContentAccess;
  now: Clock;
}

/** Services behind the practice API, created once at startup. */
export interface PracticeServices {
  exercises: ExerciseService;
}

export function createPracticeServices(deps: PracticeDeps): PracticeServices {
  return { exercises: new ExerciseService(deps) };
}
