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
    /**
     * The starter is a buggy page the learner fixes (D-069). Content metadata only: it makes the
     * task count as 디버깅 in the type mix (`content-cli` quantity rules), the same as `fix_bug`,
     * which runs without a DOM. Not sent to the client.
     */
    debugging: z.boolean().optional(),
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

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
const LINE_COMMENT = /\/\/[^\n]*/g;
const blankAfter = (text: string, ...comments: RegExp[]) =>
  comments.reduce((rest, pattern) => rest.replace(pattern, ''), text).trim() === '';
const elementBodies = (html: string, tag: 'style' | 'script') =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi'))].map(
    (m) => m[1] ?? '',
  );

/**
 * Whether the starter leaves the focused part for the learner to write (작성형, D-084). Decided
 * from the starter text only, so the same spec always gives the same answer:
 * - `html`: the whole file is empty apart from whitespace and HTML comments.
 * - `css`: every `<style>` element is empty apart from whitespace and CSS comments, and there is
 *   no `style` attribute and no stylesheet `<link>` (the given markup is what the CSS styles).
 * - `dom`: every `<script>` element is empty apart from whitespace and JS comments, there is no
 *   `<script src>` and no inline `on…` handler.
 * - `project` tasks and pages to fix (`debugging`) are never writing tasks.
 */
export function webTaskStartsEmpty(spec: Pick<WebTaskSpec, 'focus' | 'debugging' | 'starter'>) {
  if (spec.debugging === true) return false;
  const html = spec.starter.files.map((f) => f.content).join('\n');
  const markup = html.replace(HTML_COMMENT, '');
  switch (spec.focus) {
    case 'html':
      return blankAfter(html, HTML_COMMENT);
    case 'css':
      return (
        elementBodies(markup, 'style').every((body) => blankAfter(body, BLOCK_COMMENT)) &&
        !/<[a-z][^>]*\sstyle\s*=/i.test(markup) &&
        !/<link\b[^>]*stylesheet/i.test(markup)
      );
    case 'dom':
      return (
        elementBodies(markup, 'script').every((body) =>
          blankAfter(body, BLOCK_COMMENT, LINE_COMMENT),
        ) &&
        !/<script\b[^>]*\ssrc\s*=/i.test(markup) &&
        !/<[a-z][^>]*\son[a-z]+\s*=/i.test(markup)
      );
    case 'project':
      return false;
  }
}

export const webTask: ExerciseTypeDef<WebTaskSpec, WebTaskPublicSpec, CodeAnswer> = {
  id: 'web_task',
  version: VERSION,
  category: 'production',
  specSchema: webTaskSpecSchema,
  publicSpecSchema: webTaskPublicSpecSchema,
  answerSchema: codeAnswerSchema,
  requiresRun: () => true,
  writing: webTaskStartsEmpty,

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
