import { z } from 'zod';

import {
  checkListSchema,
  identifierSchema,
  publicCheckSchema,
  redactCheck,
} from '../checks/schema.ts';
import { editDistanceExceeds, tokenize } from '../common/edit-distance.ts';
import { misconceptionIdSchema } from '../core/ids.ts';
import type { ExerciseTypeDef, VerifyIssue } from '../core/types.ts';
import {
  buildCheckRunPlan,
  codeAnswerSchema,
  fileSetSchema,
  gradeWithChecks,
  languageOf,
  orderFiles,
  solutionKeyLines,
  toRunFiles,
  verifyChecks,
  type CodeAnswer,
  type CodeFile,
} from './code-common.ts';

/** docs/design/content-and-exercises.md#fix_bug-버그-수정 */
const VERSION = 1;

/** Score multiplier when the learner rewrote more than `maxEditDistance` tokens (verdict unchanged). */
export const REWRITE_PENALTY = 0.8;

const jsFileSetSchema = fileSetSchema.refine(
  (set) => set.files.every((f) => languageOf(f.path) === 'js'),
  'fix_bug files must be .js',
);

export const fixBugSpecSchema = z.object({
  /** Buggy code given to the learner. */
  buggy: jsFileSetSchema,
  entry: identifierSchema.optional(),
  /** Fixed code (answer key). */
  solution: jsFileSetSchema,
  checks: checkListSchema,
  /** Symptom only, shown to the learner. */
  bugDescription: z.string().min(1).max(1_000),
  /** Token edit-distance budget (prevents rewriting from scratch). */
  maxEditDistance: z.int().min(1).max(10_000).nullish(),
  /** Misconception this bug represents; reported when the submission is still incorrect. */
  bugMisconception: misconceptionIdSchema.nullish(),
  limits: z.object({ timeoutMs: z.int().min(100).max(10_000) }).optional(),
});
export type FixBugSpec = z.infer<typeof fixBugSpecSchema>;

export const fixBugPublicSpecSchema = z.object({
  buggy: z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })) }),
  entry: z.string().optional(),
  checks: z.array(publicCheckSchema),
  bugDescription: z.string(),
  maxEditDistance: z.int().optional(),
  limits: z.object({ timeoutMs: z.int() }).optional(),
});
export type FixBugPublicSpec = z.infer<typeof fixBugPublicSpecSchema>;

function joined(files: readonly CodeFile[]): string {
  return files.map((f) => f.content).join('\n');
}

export const fixBug: ExerciseTypeDef<FixBugSpec, FixBugPublicSpec, CodeAnswer> = {
  id: 'fix_bug',
  version: VERSION,
  category: 'production',
  specSchema: fixBugSpecSchema,
  publicSpecSchema: fixBugPublicSpecSchema,
  answerSchema: codeAnswerSchema,
  requiresRun: () => true,

  redact(spec) {
    const out: FixBugPublicSpec = {
      buggy: { files: spec.buggy.files.map(({ path, content }) => ({ path, content })) },
      checks: spec.checks.map(redactCheck),
      bugDescription: spec.bugDescription,
    };
    if (spec.entry !== undefined) out.entry = spec.entry;
    if (spec.maxEditDistance !== null && spec.maxEditDistance !== undefined)
      out.maxEditDistance = spec.maxEditDistance;
    if (spec.limits) out.limits = spec.limits;
    return out;
  },

  buildRunPlan(spec, answer, options) {
    const files = toRunFiles(orderFiles(answer.files, spec.buggy.files), ['js']);
    return buildCheckRunPlan({
      mode: 'js-console',
      files,
      entry: files[0]?.path ?? 'main.js',
      checks: spec.checks,
      options,
      ...(spec.entry === undefined ? {} : { functionName: spec.entry }),
      ...(spec.limits ? { checkTimeoutMs: spec.limits.timeoutMs } : {}),
    });
  },

  grade({ spec, answer, run, serverFindings }) {
    const budget = spec.maxEditDistance;
    return gradeWithChecks({
      typeId: 'fix_bug',
      version: VERSION,
      checks: spec.checks,
      run,
      serverFindings,
      functionName: spec.entry,
      extraMisconceptions: [spec.bugMisconception ?? undefined],
      adjust(grade) {
        if (budget === null || budget === undefined) return;
        const original = tokenize(joined(spec.buggy.files));
        const submitted = tokenize(joined(orderFiles(answer.files, spec.buggy.files)));
        if (editDistanceExceeds(original, submitted, budget)) {
          grade.score *= REWRITE_PENALTY;
          grade.feedback.push({
            level: 'warning',
            code: 'FIX_BUG_REWRITE',
            message: '코드를 새로 쓰지 말고 버그만 고쳐 보세요.',
          });
        }
      },
    });
  },

  verify(spec) {
    const issues: VerifyIssue[] = verifyChecks(spec.checks, {
      allowDom: false,
      hasEntry: spec.entry !== undefined,
    });
    if (spec.maxEditDistance !== null && spec.maxEditDistance !== undefined) {
      const distanceOk = !editDistanceExceeds(
        tokenize(joined(spec.buggy.files)),
        tokenize(joined(spec.solution.files)),
        spec.maxEditDistance,
      );
      if (!distanceOk) {
        issues.push({
          severity: 'error',
          code: 'FIX_BUG_SOLUTION_OVER_BUDGET',
          message: '정답 코드가 maxEditDistance보다 많이 고쳐져 있습니다.',
          path: 'maxEditDistance',
        });
      }
    }
    return issues;
  },

  leakFingerprints(spec) {
    return solutionKeyLines(spec.solution.files, spec.buggy.files);
  },
};
