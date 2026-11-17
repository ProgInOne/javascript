import type {
  ExerciseView,
  LessonDetail,
  ProjectAttemptResponse,
  ProjectView,
  RunPlan,
} from '@proginone/shared';
import type * as RunnerModule from '../runner/runner.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render-app.tsx';
import { lesson, mcqView, practiceSet, runResult, SET_ID } from '../../test/practice-fixtures.ts';
import { projectDraftKey } from './Project.tsx';

// Project units (content-and-exercises.md#프로젝트-단원-kind-project): milestone progress from the
// latest run, resume from the saved code, grading runs, completion.

const runs: RunPlan[] = [];
vi.mock('../runner/runner.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RunnerModule>();
  const host = {
    run: (plan: RunPlan) => {
      runs.push(plan);
      return Promise.resolve(runResult([]));
    },
    abort: () => undefined,
    ready: () => Promise.resolve(),
    dispose: () => undefined,
    stats: { shellsCreated: 1, usingFallback: false },
  };
  return { ...actual, consoleRunner: () => host, previewRunner: () => host };
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  runs.length = 0;
});

const PROJECT_ID = 'js-basics.start.mini-project';
const EXERCISE_ID = `${PROJECT_ID}.build`;
const SAVED = '<main><h1>목록</h1></main>';

const projectLesson: LessonDetail = {
  ...lesson,
  id: PROJECT_ID,
  title: '미니 프로젝트',
  kind: 'project',
  project: { exerciseId: EXERCISE_ID, milestoneCount: 3, practiceCount: 2, estimatedMinutes: 45 },
};

const check = (id: string, description: string) => ({
  id,
  kind: 'dom',
  visible: true,
  required: true,
  weight: 1,
  description,
  selector: 'main',
  expect: { exists: true },
});

const view: ExerciseView = {
  id: EXERCISE_ID,
  type: 'web_task',
  category: 'production',
  difficulty: 4,
  lessonId: PROJECT_ID,
  prompt: '할 일 목록 화면을 **단계별로** 만드세요.',
  code: null,
  codeLanguage: null,
  publicSpec: {
    focus: 'project',
    starter: { files: [{ path: 'index.html', content: '<main></main>' }] },
    viewports: [1280],
    checks: [
      check('p-title', '제목이 있어야 합니다.'),
      check('p-list', '목록이 있어야 합니다.'),
      check('p-note', '안내 문장이 있어야 합니다.'),
    ],
    milestones: [
      { id: 'm1', title: '제목 만들기', checks: ['p-title'] },
      { id: 'm2', title: '목록 만들기', checks: ['p-list'] },
      { id: 'm3', title: '안내 문장 넣기', checks: ['p-note'] },
    ],
  },
  estimatedSeconds: 2400,
  requiresRun: true,
  writing: false,
  hintCount: 3,
  openedHints: [],
  solutionViewed: false,
};

const milestoneTitles = ['제목 만들기', '목록 만들기', '안내 문장 넣기'];

function projectView(passed: number | null, over: Partial<ProjectView> = {}): ProjectView {
  return {
    lessonId: PROJECT_ID,
    exerciseId: EXERCISE_ID,
    status: passed === null ? 'not_started' : passed === 3 ? 'completed' : 'practicing',
    completedAt: passed === 3 ? 2 : null,
    milestones: milestoneTitles.map((title, i) => ({
      id: `m${String(i + 1)}`,
      title,
      checkCount: 1,
      passed: passed === null ? null : i < passed,
      blocked: passed !== null && i > passed,
    })),
    passedCount: passed ?? 0,
    runCount: passed === null ? 0 : 1,
    lastRun: passed === null ? null : { attemptId: 'a1', at: 1, outcome: 'partial', score: 0.3 },
    savedAnswer: passed === null ? null : { files: [{ path: 'index.html', content: SAVED }] },
    savedAt: passed === null ? null : 1,
    ...over,
  };
}

function attempt(passed: number, before: number): ProjectAttemptResponse {
  const done = passed === 3;
  return {
    attempt: {
      id: `01JD3Z8Q6V2K9M4T7R1X5W0AT${String(passed)}`,
      outcome: done ? 'correct' : 'partial',
      score: passed / 3,
      correct: done,
      graded: true,
      counted: done,
      attemptNo: passed,
    },
    grade: {
      feedback: [],
      checkResults: [],
      milestones: milestoneTitles.map((title, i) => ({
        id: `m${String(i + 1)}`,
        title,
        passed: i < passed,
      })),
      misconceptions: [],
      explanation: done ? '제목, 목록, 안내 문장을 차례로 더했어요.' : '',
    },
    masteryChanges: done
      ? [
          {
            conceptId: 'js.basics.statement',
            title: '문장과 실행 순서',
            scoreBefore: 40,
            scoreAfter: 70,
            stageBefore: 'introduced',
            stageAfter: 'practicing',
          },
        ]
      : [],
    misconceptionChanges: [],
    newlyPassed: milestoneTitles.map((_, i) => `m${String(i + 1)}`).slice(before, passed),
    completedNow: done,
    project: projectView(passed, { runCount: passed }),
  };
}

function projectApi(initial: ProjectView) {
  const results = [attempt(2, 1), attempt(3, 2)];
  const handler = (method: string, path: string) => {
    if (path === '/settings') return { body: { theme: 'system' } };
    if (path === `/lessons/${encodeURIComponent(PROJECT_ID)}`) return { body: projectLesson };
    if (path === `/lessons/${encodeURIComponent(PROJECT_ID)}/project`) return { body: initial };
    if (path.startsWith(`/exercises/${encodeURIComponent(EXERCISE_ID)}`) && method === 'GET')
      return { body: view };
    if (path.endsWith('/run-plan')) {
      return {
        body: {
          v: 1,
          mode: 'dom',
          purpose: 'grading',
          files: [{ path: 'index.html', language: 'html', content: 'x' }],
          entry: 'index.html',
          timers: 'real',
          checks: { v: 1, expose: [], steps: [] },
        },
      };
    }
    if (method === 'POST' && path === '/practice-sets')
      return { body: practiceSet({ lessonId: PROJECT_ID, passRule: null }) };
    if (path === `/practice-sets/${SET_ID}`)
      return { body: practiceSet({ lessonId: PROJECT_ID, passRule: null }) };
    if (path.startsWith('/exercises/') && method === 'GET') return { body: mcqView };
    if (method === 'POST' && path === `/lessons/${encodeURIComponent(PROJECT_ID)}/project/attempts`)
      return { status: 201, body: results.shift() };
    return {
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: '없음', retryable: false } },
    };
  };
  return handler;
}

const milestone = (name: RegExp) => {
  const list = screen.getByRole('region', { name: '마일스톤' });
  return within(list)
    .getAllByRole('listitem')
    .find((li) => name.test(li.textContent));
};

describe('project unit', () => {
  it('resumes, grades milestone by milestone and completes the project', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/learn/${PROJECT_ID}?mode=practice`, projectApi(projectView(1)));

    expect(await screen.findByRole('heading', { level: 1, name: /미니 프로젝트/ })).toBeVisible();
    expect(screen.getByRole('link', { name: '프로젝트' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/마지막으로 채점한 코드에서 이어서 해요/)).toBeVisible();
    expect(screen.getByText('3개 중 1개 통과')).toBeVisible();
    expect(milestone(/제목 만들기/)).toHaveTextContent('통과');
    expect(milestone(/목록 만들기/)).toHaveAttribute('aria-current', 'step');
    expect(milestone(/목록 만들기/)).toHaveTextContent('아직');
    // After a failed step, event milestones may never have been reached.
    expect(milestone(/안내 문장 넣기/)).toHaveTextContent('앞 단계 먼저');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');

    // A partial run: the next milestone passes.
    await user.click(screen.getByRole('button', { name: '채점하기' }));
    const sent = await waitFor(() => {
      const call = calls.find((c) => c.path.endsWith('/project/attempts'));
      expect(call).toBeDefined();
      return call;
    });
    expect(sent?.body).toMatchObject({
      exerciseId: EXERCISE_ID,
      answer: { files: [{ path: 'index.html', content: SAVED }] },
      runResult: { status: 'completed' },
    });
    expect(runs.some((r) => r.purpose === 'grading')).toBe(true);
    expect(await screen.findByText('3개 중 2개 통과')).toBeVisible();
    expect(screen.getByText(/새로 통과: 목록 만들기/)).toBeVisible();
    expect(screen.queryByText(/모든 마일스톤을 통과했어요/)).toBeNull();

    // Every milestone: the unit is complete, the explanation and the next lesson appear.
    await user.click(screen.getByRole('button', { name: '채점하기' }));
    expect(await screen.findByText('모든 마일스톤을 통과했어요!')).toBeVisible();
    expect(screen.getByText('완성')).toBeVisible();
    expect(screen.getByText('3개 중 3개 통과')).toBeVisible();
    expect(screen.getByText('제목, 목록, 안내 문장을 차례로 더했어요.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /다음: 오류 읽기/ })).toBeVisible();
    expect(screen.getByText('문장과 실행 순서')).toBeVisible();
  });

  it('starts from the starter before the first run and prefers a newer browser draft', async () => {
    localStorage.setItem(
      `proginone:draft:${projectDraftKey(PROJECT_ID)}`,
      JSON.stringify({ files: [{ path: 'index.html', content: '<main><h1>초안</h1></main>' }] }),
    );
    const user = userEvent.setup();
    const { calls } = renderApp(`/learn/${PROJECT_ID}?mode=practice`, projectApi(projectView(1)));
    expect(await screen.findByText(/저장해 둔 작성 중인 코드에서 이어서 해요/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '채점하기' }));
    await waitFor(() => {
      expect(calls.find((c) => c.path.endsWith('/project/attempts'))?.body).toMatchObject({
        answer: { files: [{ content: '<main><h1>초안</h1></main>' }] },
      });
    });
  });

  it('shows untouched milestones before the first run', async () => {
    renderApp(`/learn/${PROJECT_ID}?mode=practice`, projectApi(projectView(null)));
    expect(await screen.findByText('3개 중 0개 통과')).toBeVisible();
    expect(milestone(/제목 만들기/)).toHaveTextContent('채점 전');
    expect(screen.getByText(/아직 채점하지 않았어요/)).toBeVisible();
    expect(screen.queryByText(/이어서 해요/)).toBeNull();
  });

  it('opens the preparation practice as a lesson set and leads back to the project', async () => {
    const user = userEvent.setup();
    const { router, calls } = renderApp(
      `/learn/${PROJECT_ID}?mode=practice`,
      projectApi(projectView(null)),
    );
    await user.click(await screen.findByRole('button', { name: '준비 연습 하기' }));
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/practice-sets',
      body: { kind: 'lesson', lessonId: PROJECT_ID },
    });
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ mode: 'practice', set: SET_ID });
    });
    expect(await screen.findByText(/미니 프로젝트 준비 연습/)).toBeVisible();
  });

  it('offers the project from reading mode', async () => {
    renderApp(`/learn/${PROJECT_ID}`, projectApi(projectView(null)));
    expect(await screen.findByRole('link', { name: '프로젝트' })).toBeVisible();
  });
});
