import { z } from 'zod';

import { checkListSchema, publicCheckSchema, redactCheck } from '../checks/schema.ts';
import { localIdSchema, uniqueIds } from '../common/schemas.ts';
import { ExerciseKitError } from '../core/errors.ts';
import type { ExerciseTypeDef, VerifyIssue } from '../core/types.ts';
import {
  buildCheckRunPlan,
  codeAnswerSchema,
  codeFileSchema,
  gradeWithChecks,
  solutionKeyLines,
  toRunFiles,
  verifyChecks,
  type CodeAnswer,
} from './code-common.ts';

/**
 * docs/design/content-and-exercises.md#web_task-웹-실습 — P0 basic form: a single `index.html`
 * (with inline `<style>`/`<script>`), one preview, DOM/CSS checks. Multiple files, viewport
 * switching and the inspector are P1.
 */
const VERSION = 1;

export const WEB_TASK_ENTRY = 'index.html';

const singleHtmlSchema = z.object({
  files: z
    .array(codeFileSchema)
    .length(1)
    .refine(
      (files) => files[0]?.path === WEB_TASK_ENTRY,
      `basic web_task has exactly one ${WEB_TASK_ENTRY}`,
    ),
});

export const webTaskSpecSchema = z
  .object({
    focus: z.enum(['html', 'css', 'dom', 'project']),
    starter: singleHtmlSchema,
    /** Reference result (answer key; shown side by side only after the hint ladder). */
    solution: singleHtmlSchema,
    /** Check viewports. P0 uses the first one only. */
    viewports: z.array(z.int().min(320).max(1_920)).min(1).max(3).default([1_280]),
    timers: z.enum(['real', 'virtual']).default('real'),
    checks: checkListSchema,
    milestones: z
      .array(
        z.object({
          id: localIdSchema,
          title: z.string().min(1).max(200),
          checks: z.array(localIdSchema).min(1).max(50),
        }),
      )
      .max(20)
      .optional(),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set(spec.checks.map((c) => c.id));
    spec.milestones?.forEach((m, i) => {
      for (const id of m.checks) {
        if (!ids.has(id))
          ctx.addIssue({
            code: 'custom',
            message: `unknown check ${id}`,
            path: ['milestones', i, 'checks'],
          });
      }
    });
    if (spec.milestones) {
      uniqueIds(
        spec.milestones.map((m) => m.id),
        ctx,
        ['milestones'],
        'milestone',
      );
    }
    spec.checks.forEach((c, i) => {
      if (c.kind === 'call')
        ctx.addIssue({
          code: 'custom',
          message: 'web_task has no entry function for call checks',
          path: ['checks', i],
        });
    });
  });
export type WebTaskSpec = z.infer<typeof webTaskSpecSchema>;

export const webTaskPublicSpecSchema = z.object({
  focus: z.enum(['html', 'css', 'dom', 'project']),
  starter: z.object({ files: z.array(z.object({ path: z.string(), content: z.string() })) }),
  viewports: z.array(z.int()),
  checks: z.array(publicCheckSchema),
  milestones: z
    .array(z.object({ id: z.string(), title: z.string(), checks: z.array(z.string()) }))
    .optional(),
});
export type WebTaskPublicSpec = z.infer<typeof webTaskPublicSpecSchema>;

export const webTask: ExerciseTypeDef<WebTaskSpec, WebTaskPublicSpec, CodeAnswer> = {
  id: 'web_task',
  version: VERSION,
  category: 'production',
  specSchema: webTaskSpecSchema,
  publicSpecSchema: webTaskPublicSpecSchema,
  answerSchema: codeAnswerSchema,
  requiresRun: () => true,

  redact(spec) {
    const out: WebTaskPublicSpec = {
      focus: spec.focus,
      starter: { files: spec.starter.files.map(({ path, content }) => ({ path, content })) },
      viewports: spec.viewports,
      checks: spec.checks.map(redactCheck),
    };
    if (spec.milestones)
      out.milestones = spec.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        checks: [...m.checks],
      }));
    return out;
  },

  buildRunPlan(spec, answer, options) {
    if (answer.files.length !== 1 || answer.files[0]?.path !== WEB_TASK_ENTRY) {
      throw new ExerciseKitError(
        'INVALID_ANSWER',
        `basic web_task accepts exactly one ${WEB_TASK_ENTRY}`,
      );
    }
    return buildCheckRunPlan({
      mode: 'dom',
      files: toRunFiles(answer.files, ['html']),
      entry: WEB_TASK_ENTRY,
      checks: spec.checks,
      options,
      viewports: spec.viewports,
      timers: spec.timers,
    });
  },

  grade({ spec, run, serverFindings }) {
    return gradeWithChecks({
      typeId: 'web_task',
      version: VERSION,
      checks: spec.checks,
      run,
      serverFindings,
      milestones: spec.milestones,
    });
  },

  verify(spec) {
    const issues: VerifyIssue[] = verifyChecks(spec.checks, { allowDom: true, hasEntry: false });
    if (spec.viewports.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'WEB_TASK_MULTI_VIEWPORT_P1',
        message: '여러 뷰포트는 P1입니다. v0.1은 체크별 viewport만 반영합니다.',
        path: 'viewports',
      });
    }
    return issues;
  },

  leakFingerprints(spec) {
    return solutionKeyLines(spec.solution.files, spec.starter.files);
  },
};
