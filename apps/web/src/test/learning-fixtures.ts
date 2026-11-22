import type {
  CourseDetail,
  CourseList,
  CourseSummary,
  DailyPlanView,
  GoalStatus,
  GoalView,
  LearnerProfile,
  MasteryOverview,
  ReviewQueue,
  WeakConcepts,
} from '@proginone/shared';

// Fake API data for onboarding, goals and the dashboard (@proginone/shared learning.ts).

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

// ── Dashboard ──

type Tile = MasteryOverview['courses'][number]['modules'][number]['concepts'][number];

export function tile(id: string, title: string, over: Partial<Tile> = {}): Tile {
  return {
    id,
    title,
    importance: 'core',
    stage: 'not_started',
    effective: 0,
    reviewDue: false,
    nextReviewDate: null,
    misconceptions: [],
    ...over,
  };
}

/** `GET /mastery` with two modules; `tiles` replace the default not-started concepts. */
export function masteryOverview(
  tiles?: { start: Tile[]; values: Tile[] },
  completed = 0,
): MasteryOverview {
  const start = tiles?.start ?? [
    tile('js.basics.statement', '문장과 실행 순서'),
    tile('js.basics.console-log', 'console.log로 출력하기'),
  ];
  const values = tiles?.values ?? [
    tile('js.basics.let', 'let 선언'),
    tile('js.basics.const', 'const 선언'),
  ];
  const counts = { not_started: 0, introduced: 0, practicing: 0, proficient: 0, mastered: 0 };
  for (const t of [...start, ...values]) counts[t.stage] += 1;
  return {
    date: TODAY,
    courses: [
      {
        id: 'js-basics',
        title: 'JavaScript 기초',
        language: 'javascript',
        lessons: { total: 2, completed },
        stageCounts: counts,
        modules: [
          {
            id: 'js-basics.start',
            title: '시작하기',
            lessons: { total: 1, completed: Math.min(1, completed) },
            concepts: start,
          },
          {
            id: 'js-basics.values',
            title: '값과 변수',
            lessons: { total: 1, completed: Math.max(0, completed - 1) },
            concepts: values,
          },
        ],
      },
    ],
  };
}

export const emptyQueue: ReviewQueue = {
  date: TODAY,
  budgetMinutes: 15,
  due: [],
  deferred: [],
  estimatedMinutes: 0,
};

export const noWeakConcepts: WeakConcepts = { concepts: [], suggested: [] };
