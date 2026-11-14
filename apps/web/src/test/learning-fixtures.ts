import type {
  CourseDetail,
  CourseList,
  CourseSummary,
  DailyPlanView,
  GoalStatus,
  GoalView,
  LearnerProfile,
} from '@proginone/shared';

// Fake API data for onboarding, goals and the dashboard (packages/shared/src/learning.ts).

export const TODAY = '2026-11-15';
export const FIRST_LESSON = { id: 'js-basics.start.first-program', title: '첫 프로그램' };

export const newLearner: LearnerProfile = {
  experienceLevel: 'none',
  onboardedAt: null,
  needsOnboarding: true,
};
export const onboarded: LearnerProfile = {
  experienceLevel: 'some',
  onboardedAt: 1,
  needsOnboarding: false,
};

export const defaultGoal: GoalView = {
  dailyMinutes: 30,
  weeklyDays: 5,
  targetCourse: null,
  targetDate: null,
  effectiveFrom: null,
  isDefault: true,
};

const WEEK = [
  '2026-11-09',
  '2026-11-10',
  '2026-11-11',
  '2026-11-12',
  '2026-11-13',
  '2026-11-14',
  '2026-11-15',
];

/** `GET /goals` with today's minutes and the minutes of earlier days this week. */
export function goalStatus(
  todayMinutes = 0,
  earlier: readonly number[] = [],
  goal: Partial<GoalView> = {},
): GoalStatus {
  const full = { ...defaultGoal, ...goal };
  const days = WEEK.map((date, i) => {
    const minutes = date === TODAY ? todayMinutes : (earlier[i] ?? 0);
    return {
      date,
      activeMinutes: minutes,
      studied: minutes >= 5,
      goalMet: minutes >= full.dailyMinutes,
    };
  });
  const studiedDays = days.filter((d) => d.studied).length;
  return {
    date: TODAY,
    goal: full,
    pace: null,
    week: {
      weekStart: WEEK[0] ?? TODAY,
      days,
      studiedDays,
      goalDays: days.filter((d) => d.goalMet).length,
      weeklyDays: full.weeklyDays,
      achieved: studiedDays >= full.weeklyDays,
      activeMinutes: days.reduce((s, d) => s + d.activeMinutes, 0),
    },
    streakWeeks: 0,
  };
}

const jsBasics: CourseSummary = {
  id: 'js-basics',
  title: 'JavaScript 기초',
  summary: '',
  language: 'javascript',
  level: 'basic',
  estimatedMinutes: 120,
  lessonCount: 2,
};

export const courses: CourseList = {
  packVersion: '1',
  tracks: [{ id: 'web', title: '웹 개발', summary: '', courses: [jsBasics] }],
};

export const course: CourseDetail = {
  ...jsBasics,
  objectives: [],
  modules: [
    {
      id: 'js-basics.start',
      title: '시작하기',
      summary: '',
      lessons: [
        {
          id: FIRST_LESSON.id,
          title: FIRST_LESSON.title,
          summary: '',
          kind: 'lesson',
          importance: 'core',
          estimatedMinutes: 60,
          exerciseCount: 10,
        },
        {
          id: 'js-basics.start.errors',
          title: '오류 읽기',
          summary: '',
          kind: 'lesson',
          importance: 'core',
          estimatedMinutes: 60,
          exerciseCount: 10,
        },
      ],
    },
  ],
};

/** `GET /daily-plan` of a learner with no records: the first lesson only. */
export function firstDayPlan(goal: GoalView = defaultGoal): DailyPlanView {
  return {
    date: TODAY,
    goal,
    activeMinutesToday: 0,
    budgetMinutes: goal.dailyMinutes,
    goalMet: false,
    mode: 'plan',
    blocks: [
      {
        kind: 'new_lesson',
        minutes: 27,
        reason: { code: 'new_lesson', why: 'first_lesson' },
        concepts: [],
        lesson: { ...FIRST_LESSON, status: 'not_started', practiceSetId: null },
        partial: false,
      },
    ],
    later: [],
    totalMinutes: 27,
    pace: null,
  };
}
