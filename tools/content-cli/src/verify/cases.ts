import type { ExerciseSource } from '@proginone/content-schema';
import {
  assembleParsons,
  buildFindBugRunPlan,
  buildPredictExpectationPlan,
  buildRunPlan,
  derivePredictExpected,
  ExerciseKitError,
  gradeSubmission,
  observeSymptom,
  parseSpec,
  parsonsPublicId,
  parsonsReferenceAnswer,
  type CheckFailReason,
  type CheckResult,
  type CodeFile,
  type FillBlankSpec,
  type FindBugLineSpec,
  type ParsonsAnswer,
  type ParsonsSpec,
  type PredictExpected,
  type PredictOutputSpec,
} from '@proginone/exercise-kit';
import { formatValue, type RunError, type RunPlan, type RunResult } from '@proginone/shared';
import { canonical } from '../hash.ts';
import type { LessonNode } from '../mdx.ts';

/**
 * Execution verification cases (docs/design/content-and-exercises.md#4단계-실행-검증-content-cli-check---run).
 *
 * Everything here is browser-independent: a {@link PlanRunner} executes run plans (the real
 * runner in headless Chromium for `check --run`, a fake in unit tests) and these functions turn
 * the results into verdicts with Korean messages for authors.
 */

/** Executes one run plan with the app's runner and returns its result. */
export interface PlanRunner {
  run(plan: RunPlan): Promise<RunResult>;
}

export type VerifyStatus = 'pass' | 'fail' | 'skip';

export interface VerifyOutcome {
  status: VerifyStatus;
  /** Korean, one line each. Failures explain what to fix. */
  messages: string[];
  /** predict_output: the answer key computed from the runs. */
  expected?: PredictExpected;
}

/** How many times a predict_output program runs for the determinism check. */
export const PREDICT_RUNS = 3;

/** Graded by the server outside the sandbox (acorn, html-validate), not by a run. */
const SERVER_CHECK_KINDS = new Set(['static', 'html-valid']);

const EXAMPLE_SETTLE_MS = 3_000;

const pass = (messages: string[], expected?: PredictExpected): VerifyOutcome =>
  expected === undefined ? { status: 'pass', messages } : { status: 'pass', messages, expected };
const fail = (messages: string[]): VerifyOutcome => ({ status: 'fail', messages });
const skip = (message: string): VerifyOutcome => ({ status: 'skip', messages: [message] });

// ── Describing runs ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<RunError['phase'], string> = {
  syntax: '문법 오류',
  runtime: '실행 중 오류',
  unhandled_rejection: '처리되지 않은 Promise 거부',
  loop_limit: '반복 한도 초과',
  harness: '러너 하네스 오류',
};

const STATUS_PROBLEMS: Partial<Record<RunResult['status'], string>> = {
  timeout: '시간 안에 끝나지 않았습니다(timeout)',
  loop_limit: '반복 한도를 넘어 중단되었습니다(loop_limit)',
  crashed: '실행 환경이 비정상 종료했습니다(crashed)',
  aborted: '실행이 중단되었습니다(aborted)',
};

export function describeRunError(error: RunError): string {
  const where = error.position ? ` (${error.position.file} ${error.position.line}행)` : '';
  return `${PHASE_LABELS[error.phase]}: ${error.name}: ${error.message}${where}`;
}

/** Problems of a run in author-facing words; empty when it ran cleanly. */
export function runProblems(run: RunResult): string[] {
  const problems = run.errors.map(describeRunError);
  const status = STATUS_PROBLEMS[run.status];
  if (status) problems.unshift(status);
  return problems;
}

const REASON_LABELS: Record<CheckFailReason, string> = {
  MISMATCH: '값이 기대와 다릅니다',
  MISSING_IDENTIFIER: '이름을 찾지 못했습니다',
  NOT_CALLABLE: '함수가 아닙니다',
  THREW: '오류가 났습니다',
  DID_NOT_THROW: '오류가 나지 않았습니다',
  MUTATED_ARGS: '인자를 바꿨습니다',
  SAME_REFERENCE: '같은 참조를 돌려줬습니다',
  CIRCULAR_VALUE: '순환 참조 값입니다',
  TRUNCATED_VALUE: '값이 너무 커서 잘렸습니다',
  NOT_FOUND: '요소를 찾지 못했습니다',
  INVALID_SELECTOR: '선택자가 잘못되었습니다',
  NOT_OBSERVED: '관측되지 않았습니다',
  STEP_TIMEOUT: '관측 단계가 시간 안에 끝나지 않았습니다',
  STEP_ERROR: '관측 단계에서 오류가 났습니다',
  VIOLATION: '조건을 만족하지 않습니다',
  RUN_FAILED: '실행이 실패했습니다',
};

export function describeCheck(check: CheckResult): string {
  const name = check.description ? `"${check.id}" (${check.description})` : `"${check.id}"`;
  const reason = check.reason ? REASON_LABELS[check.reason] : '실패';
  const parts = [`${name}: ${reason}`];
  if (check.detail?.expected !== undefined) parts.push(`기대 ${check.detail.expected}`);
  if (check.detail?.actual !== undefined) parts.push(`실제 ${check.detail.actual}`);
  return parts.join(' · ');
}

const clip = (text: string, max = 120) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function summarizeExpected(expected: PredictExpected): string {
  switch (expected.kind) {
    case 'console':
      return expected.lines.length === 0
        ? '출력 없음'
        : clip(`콘솔 ${expected.lines.length}줄: ${expected.lines.join(' ⏎ ')}`);
    case 'value':
      return clip(`값 ${formatValue(expected.value)}`);
    case 'error':
      return expected.thrown ? `오류 ${expected.name ?? '(이름 없음)'}` : '오류 없음';
    case 'choice':
      return `선택지 ${expected.choiceId}`;
  }
}

const kitMessage = (error: unknown) =>
  error instanceof ExerciseKitError
    ? [error.message, ...error.details].join(': ')
    : error instanceof Error
      ? error.message
      : String(error);

// ── predict_output ──────────────────────────────────────────────────────────

/** Why a run could not produce an answer key, for authors. */
function predictFailure(spec: PredictOutputSpec, run: RunResult, error: unknown): string {
  const problems = runProblems(run);
  if (run.errors.some((e) => e.phase === 'syntax')) {
    return `${problems.join(' / ')}. 문법 오류가 있는 코드는 실행 결과가 없어 예측 문제로 쓸 수 없습니다`;
  }
  if (problems.length > 0) {
    return spec.answerKind === 'error'
      ? problems.join(' / ')
      : `${problems.join(' / ')}. 오류를 묻는 문제라면 answerKind: error로 바꾸세요`;
  }
  if (spec.answerKind === 'choice') {
    return `${kitMessage(error)}. 실제 출력과 정확히 하나의 선택지만 같아야 합니다`;
  }
  return kitMessage(error);
}

async function verifyPredict(ex: ExerciseSource, runner: PlanRunner): Promise<VerifyOutcome> {
  // The key is recomputed from scratch; a stored one must not influence the run.
  const { expected: _stored, ...raw } = ex.spec;
  const spec = parseSpec('predict_output', raw) as PredictOutputSpec;
  const plan = buildPredictExpectationPlan(spec);
  const keys: PredictExpected[] = [];
  for (let i = 0; i < PREDICT_RUNS; i++) {
    const run = await runner.run(plan);
    try {
      keys.push(derivePredictExpected(spec, run));
    } catch (error) {
      return fail([
        `실행 결과로 기대값을 만들 수 없습니다(${i + 1}번째 실행): ${predictFailure(spec, run, error)}`,
      ]);
    }
  }
  const [first] = keys;
  if (!first) return fail(['실행 결과가 없습니다']);
  if (keys.some((k) => canonical(k) !== canonical(first))) {
    return fail([
      `같은 코드를 ${PREDICT_RUNS}번 실행한 결과가 서로 다릅니다(결정론 위반). 무작위 값·현재 시각·타이머 순서에 기대는 코드는 예측 문제로 쓸 수 없습니다`,
      ...keys.map((k, i) => `${i + 1}번째 실행: ${summarizeExpected(k)}`),
    ]);
  }
  return pass([`기대값 ${summarizeExpected(first)}`], first);
}

// ── Code types (reference passes, starter fails) ────────────────────────────

interface CodeCase {
  reference: unknown;
  baseline: unknown;
  /** Korean noun for the baseline, e.g. 시작 코드. */
  baselineLabel: string;
}

interface FileSet {
  files: CodeFile[];
}

/** Reference answer and the code the learner starts from, or a reason the case can't be built. */
function codeCase(type: string, spec: unknown): CodeCase | string | null {
  switch (type) {
    case 'implement_function':
    case 'web_task': {
      const s = spec as { starter: FileSet; solution: FileSet };
      return { reference: s.solution, baseline: s.starter, baselineLabel: '시작 코드' };
    }
    case 'fix_bug': {
      const s = spec as { buggy: FileSet; solution: FileSet };
      return { reference: s.solution, baseline: s.buggy, baselineLabel: '버그 코드' };
    }
    case 'fill_blank': {
      const s = spec as FillBlankSpec;
      if (s.mode !== 'code') return null;
      const missing = s.blanks.filter((b) => b.accept.length === 0).map((b) => b.id);
      if (missing.length > 0) {
        return `code 모드 빈칸에는 참조 정답으로 쓸 accept 예시가 하나 이상 필요합니다: ${missing.join(', ')}`;
      }
      return {
        reference: { blanks: Object.fromEntries(s.blanks.map((b) => [b.id, b.accept[0]])) },
        baseline: { blanks: Object.fromEntries(s.blanks.map((b) => [b.id, ''])) },
        baselineLabel: '빈칸을 비운 코드',
      };
    }
    default:
      return null;
  }
}

async function runAndGrade(ex: ExerciseSource, answer: unknown, runner: PlanRunner) {
  const plan = buildRunPlan({ typeId: ex.type, spec: ex.spec, answer, purpose: 'verification' });
  const run = await runner.run(plan);
  const grade = gradeSubmission({ typeId: ex.type, spec: ex.spec, answer, run });
  const results = grade.checkResults ?? [];
  const required = results.filter((c) => c.required && !SERVER_CHECK_KINDS.has(c.kind));
  const serverChecks = results.filter((c) => SERVER_CHECK_KINDS.has(c.kind)).length;
  return { run, required, serverChecks };
}

async function verifyCode(
  ex: ExerciseSource,
  built: CodeCase,
  runner: PlanRunner,
): Promise<VerifyOutcome> {
  const ref = await runAndGrade(ex, built.reference, runner);
  if (ref.required.length === 0) {
    return fail(['실행으로 확인하는 필수 체크가 없습니다(정적 체크만으로는 판정하지 않습니다)']);
  }
  const refFailed = ref.required.filter((c) => !c.passed);
  if (refFailed.length > 0) {
    return fail([
      `참조 정답이 필수 체크 ${refFailed.length}개를 통과하지 못합니다`,
      ...refFailed.map(describeCheck),
      ...runProblems(ref.run).map((p) => `참조 정답 실행: ${p}`),
    ]);
  }
  const base = await runAndGrade(ex, built.baseline, runner);
  const baseFailed = base.required.filter((c) => !c.passed);
  if (baseFailed.length === 0) {
    return fail([
      `${built.baselineLabel}가 이미 모든 필수 체크를 통과합니다. 학습자가 아무것도 고치지 않아도 정답이 됩니다`,
    ]);
  }
  const messages = [
    `참조 정답은 필수 체크 ${ref.required.length}개 통과, ${built.baselineLabel}는 ${baseFailed.length}개 실패`,
  ];
  if (ref.serverChecks > 0) {
    messages.push(
      `정적 체크 ${ref.serverChecks}개는 서버가 실행 없이 채점하므로 실행 검증에서 뺐습니다`,
    );
  }
  return pass(messages);
}

// ── parsons ─────────────────────────────────────────────────────────────────

/** Where a distractor is tried: in place of `replaces`, otherwise at every position. */
function distractorPlacements(
  spec: ParsonsSpec,
  distractor: ParsonsSpec['distractors'][number],
): { answer: ParsonsAnswer; where: string }[] {
  const reference = parsonsReferenceAnswer(spec).order;
  const block = (indent: number) => ({ id: parsonsPublicId(distractor.id), indent });
  if (distractor.replaces !== undefined) {
    const at = spec.lines.findIndex((l) => l.id === distractor.replaces);
    const order = [...reference];
    order.splice(at, 1, block(reference[at]?.indent ?? 0));
    return [{ answer: { order }, where: `${distractor.replaces} 대신` }];
  }
  return Array.from({ length: reference.length + 1 }, (_, at) => {
    const order = [...reference];
    order.splice(at, 0, block(reference[at]?.indent ?? reference[at - 1]?.indent ?? 0));
    return { answer: { order }, where: `${at + 1}번째 줄` };
  });
}

async function verifyParsons(ex: ExerciseSource, runner: PlanRunner): Promise<VerifyOutcome> {
  const spec = parseSpec('parsons', ex.spec) as ParsonsSpec;
  const orders = [
    { label: '정답 순서', ids: spec.lines.map((l) => l.id) },
    ...spec.alternatives.map((ids, i) => ({ label: `alternatives ${i + 1}`, ids })),
  ];

  if (!spec.checks) {
    // Graded by order: the assembled programs only have to be valid JavaScript.
    const notes: string[] = [];
    for (const order of orders) {
      const code = assembleParsons(spec, parsonsReferenceAnswer(spec, order.ids));
      const run = await runner.run(examplePlan('js', code));
      const syntax = run.errors.filter((e) => e.phase === 'syntax');
      if (syntax.length > 0) {
        return fail([
          `${order.label}로 조립한 코드에 문법 오류가 있습니다`,
          ...syntax.map(describeRunError),
        ]);
      }
      notes.push(...runProblems(run).map((p) => `${order.label} 실행(참고): ${p}`));
    }
    return pass([
      `checks가 없어 순서로 채점합니다. 정답 순서${spec.alternatives.length > 0 ? `와 대체 순서 ${spec.alternatives.length}개` : ''}로 조립한 코드에 문법 오류 없음`,
      ...notes,
    ]);
  }

  let required = 0;
  for (const order of orders) {
    const ref = await runAndGrade(ex, parsonsReferenceAnswer(spec, order.ids), runner);
    if (ref.required.length === 0) {
      return fail(['실행으로 확인하는 필수 체크가 없습니다(정적 체크만으로는 판정하지 않습니다)']);
    }
    const failed = ref.required.filter((c) => !c.passed);
    if (failed.length > 0) {
      return fail([
        `${order.label}로 조립한 코드가 필수 체크 ${failed.length}개를 통과하지 못합니다`,
        ...failed.map(describeCheck),
        ...runProblems(ref.run).map((p) => `${order.label} 실행: ${p}`),
      ]);
    }
    required = ref.required.length;
  }

  const harmless: string[] = [];
  for (const distractor of spec.distractors) {
    for (const placement of distractorPlacements(spec, distractor)) {
      const result = await runAndGrade(ex, placement.answer, runner);
      if (result.required.every((c) => c.passed)) {
        harmless.push(
          `방해 줄 ${distractor.id}(\`${distractor.code.trim()}\`)을 ${placement.where}에 넣어도 모든 필수 체크를 통과합니다`,
        );
      }
    }
  }
  if (harmless.length > 0) {
    return fail([
      ...harmless,
      '방해 줄을 쓰면 실패해야 합니다. replaces로 대신할 줄을 지정하거나 체크를 보강하세요',
    ]);
  }
  return pass([
    `정답 순서${spec.alternatives.length > 0 ? `와 대체 순서 ${spec.alternatives.length}개` : ''}가 필수 체크 ${required}개 통과, 방해 줄 ${spec.distractors.length}개는 넣으면 실패`,
  ]);
}

// ── find_bug_line ───────────────────────────────────────────────────────────

const describeSymptom = (spec: FindBugLineSpec) =>
  'console' in spec.symptomCheck
    ? `출력 ${spec.symptomCheck.console.join(' ⏎ ') || '없음'}`
    : `오류 ${spec.symptomCheck.error}`;

/** The buggy code must show the symptom; the fixed code must run cleanly without it. */
async function verifyFindBug(ex: ExerciseSource, runner: PlanRunner): Promise<VerifyOutcome> {
  const spec = parseSpec('find_bug_line', ex.spec) as FindBugLineSpec;
  const buggy = observeSymptom(spec.symptomCheck, await runner.run(buildFindBugRunPlan(spec.code)));
  if (!buggy.shown) {
    return fail([
      `버그 코드가 symptomCheck의 증상(${describeSymptom(spec)})을 내지 않습니다`,
      `버그 코드 실행: ${buggy.summary}`,
    ]);
  }
  const fixed = observeSymptom(
    spec.symptomCheck,
    await runner.run(buildFindBugRunPlan(spec.fixedCode)),
  );
  if (fixed.shown || !fixed.clean) {
    return fail([
      fixed.shown
        ? 'fixedCode에도 같은 증상이 남아 있습니다'
        : 'fixedCode가 오류 없이 실행되어야 합니다',
      `fixedCode 실행: ${fixed.summary}`,
    ]);
  }
  return pass([`버그 코드는 증상(${buggy.summary})을 내고, fixedCode는 ${fixed.summary}`]);
}

/** Verifies one exercise. Types without code to run are skipped. */
export async function verifyExercise(
  ex: ExerciseSource,
  runner: PlanRunner,
): Promise<VerifyOutcome> {
  try {
    if (ex.type === 'predict_output') return await verifyPredict(ex, runner);
    if (ex.type === 'parsons') return await verifyParsons(ex, runner);
    if (ex.type === 'find_bug_line') return await verifyFindBug(ex, runner);
    const built = codeCase(ex.type, parseSpec(ex.type, ex.spec));
    if (typeof built === 'string') return fail([built]);
    if (built === null) return skip('실행할 코드가 없는 유형입니다');
    return await verifyCode(ex, built, runner);
  } catch (error) {
    return fail([`실행 검증을 할 수 없습니다: ${kitMessage(error)}`]);
  }
}

// ── Lesson <RunnableExample> ────────────────────────────────────────────────

export interface LessonExample {
  id: string;
  lang: string;
  code: string | null;
  expectError: boolean;
}

/** `<RunnableExample>` nodes of a compiled lesson tree, in document order. */
export function collectExamples(tree: readonly LessonNode[]): LessonExample[] {
  const out: LessonExample[] = [];
  const visit = (node: LessonNode) => {
    if (node.type === 'component' && node.name === 'RunnableExample') {
      const props = node.props as Record<string, unknown>;
      out.push({
        id: String(props['id']),
        lang: String(props['lang']),
        code: typeof props['code'] === 'string' ? props['code'] : null,
        expectError: props['expectError'] === true,
      });
    }
    const children = node.children;
    if (Array.isArray(children)) for (const child of children as LessonNode[]) visit(child);
  };
  tree.forEach(visit);
  return out;
}

/** Plan for a lesson example: JS in the console sandbox, HTML documents in a hidden DOM run. */
export function examplePlan(lang: 'js' | 'html', code: string): RunPlan {
  const isJs = lang === 'js';
  return {
    v: 1,
    mode: isJs ? 'js-console' : 'dom',
    purpose: 'verification',
    files: [
      isJs
        ? { path: 'main.js', language: 'js', content: code }
        : { path: 'index.html', language: 'html', content: code },
    ],
    entry: isJs ? 'main.js' : 'index.html',
    timers: 'real',
    checks: {
      v: 1,
      expose: [],
      steps: [{ op: 'waitSettled', id: 'settle', maxMs: EXAMPLE_SETTLE_MS }],
    },
  };
}

/** A lesson example must run cleanly, or fail when it is marked `expectError`. */
export async function verifyExample(
  example: LessonExample,
  runner: PlanRunner,
): Promise<VerifyOutcome> {
  if (example.code === null) return skip('src로 불러오는 예제는 아직 실행 검증하지 않습니다');
  const lang = example.lang === 'js' ? 'js' : example.lang === 'css' ? null : 'html';
  if (lang === null) return skip('CSS만 있는 예제는 실행하지 않습니다(적용할 문서가 없습니다)');
  try {
    const problems = runProblems(await runner.run(examplePlan(lang, example.code)));
    if (example.expectError) {
      return problems.length > 0
        ? pass([`의도한 오류: ${problems[0] ?? ''}`])
        : fail([
            'expectError로 표시했지만 오류가 나지 않습니다. 표시를 지우거나 코드를 확인하세요',
          ]);
    }
    return problems.length === 0
      ? pass(['오류 없이 실행됩니다'])
      : fail([
          '오류 없이 실행되어야 합니다. 의도한 오류라면 expectError를 표시하세요',
          ...problems,
        ]);
  } catch (error) {
    return fail([`실행 검증을 할 수 없습니다: ${kitMessage(error)}`]);
  }
}
