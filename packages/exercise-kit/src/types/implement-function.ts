import { z } from 'zod';

import {
  checkListSchema,
  identifierSchema,
  publicCheckSchema,
  redactCheck,
} from '../checks/schema.ts';
import type { ExerciseTypeDef } from '../core/types.ts';
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
} from './code-common.ts';

/** docs/design/content-and-exercises.md#implement_function-함수-구현 */
const VERSION = 1;

const jsFileSetSchema = fileSetSchema.refine(
  (set) => set.files.every((f) => languageOf(f.path) === 'js'),
  'implement_function files must be .js',
);

export const implementFunctionSpecSchema = z.object({
  starter: jsFileSetSchema,
  /**
   * Function the `call` checks invoke. Optional (D-028): without it the learner writes a
   * program (top-level code) graded only by whole-program checks (`console`, `program`).
   */
  entry: identifierSchema.optional(),
  /** Reference implementation (answer key). */
  solution: jsFileSetSchema,
  checks: checkListSchema,
  limits: z.object({ timeoutMs: z.int().min(100).max(10_000) }).optional(),
});
export type ImplementFunctionSpec = z.infer<typeof implementFunctionSpecSchema>;

export const implementFunctionPublicSpecSchema = z.object({
  starter: z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })) }),
  entry: z.string().optional(),
  checks: z.array(publicCheckSchema),
  limits: z.object({ timeoutMs: z.int() }).optional(),
});
export type ImplementFunctionPublicSpec = z.infer<typeof implementFunctionPublicSpecSchema>;

export const implementFunction: ExerciseTypeDef<
  ImplementFunctionSpec,
  ImplementFunctionPublicSpec,
  CodeAnswer
> = {
  id: 'implement_function',
  version: VERSION,
  category: 'production',
  specSchema: implementFunctionSpecSchema,
  publicSpecSchema: implementFunctionPublicSpecSchema,
  answerSchema: codeAnswerSchema,
  requiresRun: () => true,
  // The learner writes the function body or the program (D-028, D-084).
  writing: () => true,

  redact(spec) {
    const out: ImplementFunctionPublicSpec = {
      starter: { files: spec.starter.files.map(({ path, content }) => ({ path, content })) },
      checks: spec.checks.map(redactCheck),
    };
    if (spec.entry !== undefined) out.entry = spec.entry;
    if (spec.limits) out.limits = spec.limits;
    return out;
  },

  buildRunPlan(spec, answer, options) {
    const files = toRunFiles(orderFiles(answer.files, spec.starter.files), ['js']);
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

  grade({ spec, run, serverFindings }) {
    return gradeWithChecks({
      typeId: 'implement_function',
      version: VERSION,
      checks: spec.checks,
      run,
      serverFindings,
      functionName: spec.entry,
    });
  },

  verify(spec) {
    return verifyChecks(spec.checks, { allowDom: false, hasEntry: spec.entry !== undefined });
  },

  leakFingerprints(spec) {
    return solutionKeyLines(spec.solution.files, spec.starter.files);
  },
};
