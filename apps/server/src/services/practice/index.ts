import type { EngineDeps } from '@proginone/learning-engine';
import type { UserDb } from '../../db/user/connection.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { ActivityService } from '../learning/activity-service.ts';
import { ConceptService } from '../learning/concept-service.ts';
import { DailyPlanService } from '../learning/daily-plan-service.ts';
import { GoalService } from '../learning/goal-service.ts';
import { DashboardService } from '../learning/dashboard-service.ts';
import { LearnerService } from '../learning/learner-service.ts';
import { LessonProgressService } from '../learning/lesson-progress-service.ts';
import { MasteryService } from '../learning/mastery-service.ts';
import { ReviewService } from '../review/review-service.ts';
import { AttemptService } from './attempt-service.ts';
import { ExerciseService } from './exercise-service.ts';
import { PracticeSetService } from './practice-set-service.ts';
import { WeaknessService } from './weakness.ts';

export interface PracticeDeps {
  userDb: UserDb;
  content: ContentAccess;
  /** Created once at startup with `createEngine()`. */
  engine: EngineDeps;
  now: Clock;
}

/** Services behind the learning-record API (practice, reading, review, activity), created once. */
export interface PracticeServices {
  exercises: ExerciseService;
  sets: PracticeSetService;
  attempts: AttemptService;
  lessons: LessonProgressService;
  review: ReviewService;
  activity: ActivityService;
  dashboard: DashboardService;
  weakness: WeaknessService;
  goals: GoalService;
  dailyPlan: DailyPlanService;
  concepts: ConceptService;
  learner: LearnerService;
  mastery: MasteryService;
}

export function createPracticeServices(deps: PracticeDeps): PracticeServices {
  const review = new ReviewService(deps);
  const weakness = new WeaknessService(deps);
  const goals = new GoalService(deps);
  return {
    exercises: new ExerciseService(deps),
    sets: new PracticeSetService({ ...deps, review, weakness }),
    attempts: new AttemptService(deps),
    lessons: new LessonProgressService(deps),
    review,
    activity: new ActivityService(deps),
    dashboard: new DashboardService({ ...deps, review }),
    weakness,
    goals,
    dailyPlan: new DailyPlanService({ ...deps, review, weakness, goals }),
    concepts: new ConceptService(deps),
    learner: new LearnerService(deps),
    mastery: new MasteryService(deps),
  };
}
