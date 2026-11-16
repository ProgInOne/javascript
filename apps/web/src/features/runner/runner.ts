import {
  createRunnerHost,
  preloadRunner,
  type RunnerHost,
  type RunnerNotice,
} from '@proginone/runner';
import type { RunPlan, RunResult } from '@proginone/shared';

/**
 * The local server that serves `/sandbox/runner.html`. In production that is this page's origin;
 * under `pnpm dev` the page comes from Vite, so the server origin is injected at build time.
 */
const SERVER_ORIGIN =
  (import.meta.env['VITE_PROGINONE_SERVER_ORIGIN'] as string | undefined) ?? location.origin;

let hidden: RunnerHost | null = null;

/** Shared hidden runner for console runs (one shell, reused; the host replaces stuck shells). */
export function consoleRunner(): RunnerHost {
  hidden ??= createRunnerHost({ serverOrigin: SERVER_ORIGIN, placement: 'hidden' });
  return hidden;
}

/**
 * Gets the first run of a screen ready while the browser is idle (D-074): loads the prepare step
 * and connects the shared hidden shell, which otherwise both happen on the first "실행". Call it
 * from screens that can run code; returns a cleanup that cancels a warm-up not started yet.
 * Browsers without `requestIdleCallback` (and jsdom) skip it: it only saves time.
 */
export function warmRunner(): () => void {
  if (typeof requestIdleCallback !== 'function') return () => undefined;
  const id = requestIdleCallback(
    () => {
      void preloadRunner();
      consoleRunner()
        .ready()
        .catch(() => undefined); // the first run reports a shell that cannot start
    },
    { timeout: 2_000 },
  );
  return () => {
    cancelIdleCallback(id);
  };
}

const NOTICE_MESSAGES: Record<RunnerNotice, string> = {
  'navigation-blocked': '미리보기에서는 링크 이동과 폼 제출이 실제로 일어나지 않아요.',
};

/** Learner-facing copy for preview notices (docs/design/code-execution-sandbox.md#미리보기). */
export function noticeMessage(notice: RunnerNotice): string {
  return NOTICE_MESSAGES[notice];
}

/**
 * A visible runner rendering into `container` (HTML preview). Dispose it when unmounting.
 * `onNotice` receives learner-facing notices (e.g. a link the preview did not follow).
 */
export function previewRunner(
  container: HTMLElement,
  onNotice?: (message: string) => void,
): RunnerHost {
  return createRunnerHost({
    serverOrigin: SERVER_ORIGIN,
    placement: 'visible',
    container,
    ...(onNotice
      ? {
          onNotice: (notice: RunnerNotice) => {
            onNotice(noticeMessage(notice));
          },
        }
      : {}),
  });
}

const noChecks = (): RunPlan['checks'] => ({ v: 1, expose: [], steps: [] });

/** Interactive run plan for a lesson example (no checks: the learner just sees the result). */
export function examplePlan(lang: 'js' | 'html', code: string): RunPlan {
  return lang === 'js'
    ? {
        v: 1,
        mode: 'js-console',
        purpose: 'interactive',
        files: [{ path: 'main.js', language: 'js', content: code }],
        entry: 'main.js',
        timers: 'real',
        checks: noChecks(),
      }
    : {
        v: 1,
        mode: 'preview',
        purpose: 'interactive',
        files: [{ path: 'index.html', language: 'html', content: code }],
        entry: 'index.html',
        timers: 'real',
        checks: noChecks(),
      };
}

/** Learner-facing status line (docs/design/code-execution-sandbox.md: exit reasons → copy). */
export function statusMessage(result: RunResult): string | null {
  switch (result.status) {
    case 'completed':
      return null;
    case 'error':
      return null; // errors are listed separately
    case 'timeout':
      return '코드가 시간 안에 끝나지 않았어요. 끝나지 않는 반복이 있는지 확인해 보세요.';
    case 'loop_limit':
      return '반복이 너무 많이 돌아서 실행을 멈췄어요. 반복 조건을 확인해 보세요.';
    case 'crashed':
      return '실행 환경이 멈춰서 다시 준비했어요. 한 번 더 실행해 보세요.';
    default:
      return '실행을 마치지 못했어요. 다시 실행해 보세요.';
  }
}
