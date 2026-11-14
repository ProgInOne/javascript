import {
  consoleEntriesToLines,
  type RunResult,
  type TutorCodeFiles,
  type TutorRunSummary,
} from '@proginone/shared';

// What the web app tells the tutor about the learner's work (packages/shared/src/ai.ts). The
// limits mirror the request schemas so a long answer never makes the request invalid.

const MAX_FILES = 10;
const MAX_FILE_CHARS = 20_000;
const MAX_PATH_CHARS = 120;

/** Code answer files → `currentCode`. Null when there is nothing to send. */
export function codeFilesOf(answer: unknown): TutorCodeFiles | null {
  if (!answer || typeof answer !== 'object' || !('files' in answer)) return null;
  const files = answer.files;
  if (!Array.isArray(files)) return null;
  const out: TutorCodeFiles = {};
  for (const f of files.slice(0, MAX_FILES)) {
    if (!f || typeof f !== 'object') continue;
    const { path, content } = f as { path?: unknown; content?: unknown };
    if (typeof path !== 'string' || typeof content !== 'string' || path === '') continue;
    out[path.slice(0, MAX_PATH_CHARS)] = content.slice(0, MAX_FILE_CHARS);
  }
  return Object.keys(out).length > 0 ? out : null;
}

interface CheckLike {
  id: string;
  passed: boolean;
  visible: boolean;
  description?: string | undefined;
}

/**
 * The last run (and the visible checks that failed when it was graded) → `lastRunResult`:
 * status, the console tail, the first error.
 */
export function runSummaryOf(
  run: RunResult | null,
  checks: readonly CheckLike[] | null | undefined,
): TutorRunSummary | null {
  if (!run) return null;
  const lines = consoleEntriesToLines(run.console)
    .slice(-50)
    .map((l) => l.slice(0, 500));
  const error = run.errors[0];
  return {
    status: run.status.slice(0, 40),
    console: lines,
    error: error ? `${error.name}: ${error.message}`.slice(0, 2_000) : null,
    failedChecks: (checks ?? [])
      .filter((c) => c.visible && !c.passed)
      .slice(0, 20)
      .map((c) => ({ id: c.id.slice(0, 120), description: (c.description ?? c.id).slice(0, 500) })),
  };
}
