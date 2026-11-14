import type { Page } from '@playwright/test';

/**
 * Fixed practice API responses for the visual and accessibility checks of the practice screen.
 * The engine orders items differently per set, so screenshots of the real flow would not be
 * stable; the screens themselves are still the production build talking to these responses.
 */

export const PRACTICE_URL =
  '/learn/js-basics.start.first-program?mode=practice&set=01JD3Z8Q6V2K9M4T7R1X5W0BNC';

const MCQ = 'js-basics.start.first-program.mcq-log-role';
const FIX = 'js-basics.start.first-program.fix-total';
const item = (position: number, exerciseId: string, type: string, difficulty: number) => ({
  id: `01JD3Z8Q6V2K9M4T7R1X5W0AT${position}`,
  position,
  exerciseId,
  type,
  difficulty,
  status: 'pending',
  reason: 'lesson_practice',
  targetConcept: { id: 'js.basics.console-log', title: 'console.log로 출력하기' },
  attempts: 0,
  lastOutcome: null,
});

const items = [item(0, MCQ, 'mcq_single', 1), item(1, FIX, 'fix_bug', 3)];
const set = {
  id: '01JD3Z8Q6V2K9M4T7R1X5W0BNC',
  kind: 'lesson',
  status: 'active',
  lessonId: 'js-basics.start.first-program',
  items,
  progress: { total: 2, answered: 0, skipped: 0, pending: 2 },
  nextItemId: items[0]?.id,
  passRule: { minCorrect: 0.7, minConceptScore: 50, minDistinctTypes: 2, minLevel3Correct: 1 },
  result: null,
  createdAt: 1,
  completedAt: null,
};

const common = {
  lessonId: 'js-basics.start.first-program',
  code: null,
  hintCount: 3,
  openedHints: [{ level: 1, text: '`log`는 "기록하다"라는 뜻이에요. 어디에 기록할까요?' }],
  solutionViewed: false,
};

const views: Record<string, unknown> = {
  [MCQ]: {
    ...common,
    id: MCQ,
    type: 'mcq_single',
    category: 'recognition',
    difficulty: 1,
    prompt: '`console.log("완료");`를 실행하면 어떤 일이 일어나나요?',
    publicSpec: {
      codeOptions: false,
      options: [
        { id: 'a', text: '콘솔에 `완료`라는 글자가 보인다' },
        { id: 'b', text: '`완료`라는 값이 저장되어 다음 줄에서 다시 쓸 수 있다' },
        { id: 'c', text: '프로그램이 끝난다' },
      ],
    },
    estimatedSeconds: 40,
    requiresRun: false,
  },
  [FIX]: {
    ...common,
    openedHints: [],
    id: FIX,
    type: 'fix_bug',
    category: 'production',
    difficulty: 3,
    prompt:
      '김밥 두 줄(1줄에 3500원)의 가격을 출력하려고 해요. 버그를 고쳐서 아래처럼 출력되게 하세요.\n\n```text\n김밥 2줄\n7000\n```\n',
    publicSpec: {
      buggy: {
        files: [
          { path: 'main.js', content: 'console.log("김밥 2줄");\nconsole.log("3500 * 2");\n' },
        ],
      },
      checks: [
        {
          id: 'output',
          weight: 1,
          kind: 'console',
          description: '"김밥 2줄"과 계산 결과 7000이 차례로 출력되어야 합니다.',
          requirement: '가격 계산 출력',
          expect: { lines: ['김밥 2줄', '7000'], mode: 'exact', allowExtraTrailing: false },
          visible: true,
          required: true,
        },
      ],
      bugDescription: '둘째 줄에 7000 대신 계산식이 글자 그대로 출력돼요.',
      maxEditDistance: 6,
    },
    estimatedSeconds: 150,
    requiresRun: true,
  },
};

const wrongAttempt = {
  attempt: {
    id: '01JD3Z8Q6V2K9M4T7R1X5W0ATT',
    outcome: 'incorrect',
    score: 0,
    correct: false,
    engineApplied: true,
    attemptNo: 1,
    attemptInItem: 1,
  },
  grade: {
    feedback: [],
    misconceptions: [{ id: 'js.mc.log-is-return', title: '출력을 반환으로 착각함' }],
    explanation: '정답은 **콘솔에 `완료`라는 글자가 보인다**예요.',
  },
  masteryChanges: [
    {
      conceptId: 'js.basics.console-log',
      title: 'console.log로 출력하기',
      scoreBefore: 0,
      scoreAfter: 4,
      stageBefore: 'not_started',
      stageAfter: 'introduced',
    },
  ],
  misconceptionChanges: [],
  remediation: null,
  item: { id: items[0]?.id, status: 'answered', attempts: 1 },
  set: {
    id: set.id,
    status: 'active',
    progress: { total: 2, answered: 1, skipped: 0, pending: 1 },
    nextItemId: items[1]?.id,
    result: null,
  },
};

export async function mockPractice(page: Page) {
  await page.route('**/api/v1/practice-sets**', (route) => route.fulfill({ json: set }));
  await page.route('**/api/v1/exercises/**', (route) => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/')[4] ?? '');
    return route.fulfill({ json: views[id] ?? {} });
  });
  await page.route('**/api/v1/attempts', (route) =>
    route.fulfill({ status: 201, json: wrongAttempt }),
  );
}

const THREAD_ID = '01JD3Z8Q6V2K9M4T7R1X5W0TH1';
const thread = {
  id: THREAD_ID,
  scopeType: 'exercise',
  scopeId: FIX,
  title: '왜 계산이 안 되나요?',
  status: 'open',
  messageCount: 2,
  createdAt: 1,
  lastMessageAt: 1,
};
const message = (id: string, role: string, content: string) => ({
  id,
  threadId: THREAD_ID,
  role,
  content,
  status: 'complete',
  taskName: role === 'tutor' ? 'tutor.reply' : null,
  taskVersion: role === 'tutor' ? 1 : null,
  meta: null,
  createdAt: 1,
});

/** A fixed tutor conversation for the drawer's visual and accessibility checks. */
export async function mockTutor(page: Page) {
  await page.route('**/api/v1/tutor/threads', (route) => route.fulfill({ json: thread }));
  await page.route(`**/api/v1/tutor/threads/${THREAD_ID}/messages`, (route) =>
    route.fulfill({
      json: {
        thread,
        messages: [
          message(
            '01JD3Z8Q6V2K9M4T7R1X5W0ML1',
            'learner',
            '7000 대신 3500 * 2가 그대로 나와요. 왜 그래요?',
          ),
          message(
            '01JD3Z8Q6V2K9M4T7R1X5W0MT1',
            'tutor',
            [
              '좋은 질문이에요. 따옴표로 감싼 부분은 **문자열**이라서 계산하지 않고 글자 그대로 출력돼요.',
              '',
              '- 따옴표 안: 글자',
              '- 따옴표 밖: 계산되는 식',
              '',
              '```js',
              'console.log("1 + 1"); // 1 + 1',
              'console.log(1 + 1);   // 2',
              '```',
              '',
              '둘째 줄에서 어느 부분이 따옴표 안에 있는지 확인해 볼래요?',
            ].join('\n'),
          ),
        ],
      },
    }),
  );
}
