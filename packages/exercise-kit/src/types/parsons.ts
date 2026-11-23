import { z } from 'zod';

import {
  checkListSchema,
  identifierSchema,
  publicCheckSchema,
  redactCheck,
} from '../checks/schema.ts';
import {
  buildResult,
  createRng,
  leakSet,
  localIdSchema,
  misconceptionIdSchema,
  normalizeLeakText,
  seedFromString,
  uniqueIds,
} from '@proginone/exercise-core';
import type { ExerciseTypeDef, FeedbackItem, VerifyIssue } from '../core/types.ts';
import { buildCheckRunPlan, gradeWithChecks, verifyChecks } from './code-common.ts';

/** docs/design/content-and-exercises.md#parsons-코드-순서-배열 */
const VERSION = 1;

export const PARSONS_MAX_INDENT = 8;
/** Spaces per indent level when blocks are assembled into code. */
export const PARSONS_INDENT_WIDTH = 2;
/** Score credit of a line in the right order but at the wrong indent (when indent is graded). */
const WRONG_INDENT_CREDIT = 0.5;

const codeLineSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((code) => !code.includes('\n'), 'a block is one line of code')
  .refine((code) => code.trim() !== '', 'a block cannot be blank');

const lineSchema = z.object({
  id: localIdSchema,
  code: codeLineSchema,
  /** Indent level in the correct program (answer key). */
  indent: z.int().min(0).max(PARSONS_MAX_INDENT).default(0),
});

const distractorSchema = z.object({
  id: localIdSchema,
  code: codeLineSchema,
  /** Misconception suggested by using this block (answer key). */
  misconception: misconceptionIdSchema.optional(),
  /**
   * The line this block is a wrong version of (answer key). `check --run` substitutes it there
   * and expects a check to fail; without it the block is tried at every position.
   */
  replaces: localIdSchema.optional(),
});

export const parsonsSpecSchema = z
  .object({
    /** The program's lines in the correct order (the order is the answer key). */
    lines: z.array(lineSchema).min(2).max(30),
    /** Blocks that belong nowhere (answer key: which blocks they are). */
    distractors: z.array(distractorSchema).max(10).default([]),
    /** Whether indent levels are graded (order-graded exercises). */
    gradeIndent: z.boolean().default(true),
    /** Other accepted orders: each lists every line ID exactly once. */
    alternatives: z.array(z.array(localIdSchema)).max(10).default([]),
    /** With checks: function `call` checks invoke. */
    entry: identifierSchema.optional(),
    /** When present, the assembled code is run and these checks decide (any working order passes). */
    checks: checkListSchema.optional(),
  })
  .superRefine((spec, ctx) => {
    const lineIds = spec.lines.map((l) => l.id);
    uniqueIds([...lineIds, ...spec.distractors.map((d) => d.id)], ctx, [], 'block');
    const publicIds = [...spec.lines, ...spec.distractors].map((b) => parsonsPublicId(b.id));
    if (new Set(publicIds).size !== publicIds.length) {
      ctx.addIssue({ code: 'custom', message: 'block ids collide; rename one', path: ['lines'] });
    }
    const sorted = [...lineIds].sort().join('\n');
    spec.alternatives.forEach((order, index) => {
      if ([...order].sort().join('\n') !== sorted) {
        ctx.addIssue({
          code: 'custom',
          message: 'an alternative must list every line id exactly once',
          path: ['alternatives', index],
        });
      }
    });
    spec.distractors.forEach((d, index) => {
      if (d.replaces !== undefined && !lineIds.includes(d.replaces)) {
        ctx.addIssue({
          code: 'custom',
          message: `replaces must be a line id: ${d.replaces}`,
          path: ['distractors', index, 'replaces'],
        });
      }
    });
  });
export type ParsonsSpec = z.infer<typeof parsonsSpecSchema>;

export const parsonsPublicSpecSchema = z.object({
  /** Lines and distractors, shuffled, with opaque IDs. Never in the correct order. */
  blocks: z.array(z.object({ id: z.string().max(64), code: z.string() })),
  gradeIndent: z.boolean(),
  entry: z.string().optional(),
  checks: z.array(publicCheckSchema).optional(),
});
export type ParsonsPublicSpec = z.infer<typeof parsonsPublicSpecSchema>;

export const parsonsAnswerSchema = z.object({
  order: z
    .array(
      z.object({
        id: z.string().max(64),
        indent: z.int().min(0).max(PARSONS_MAX_INDENT),
      }),
    )
    .max(50),
});
export type ParsonsAnswer = z.infer<typeof parsonsAnswerSchema>;

/**
 * Public block ID for an authored line/distractor ID. Authored IDs often encode the answer
 * (`l1`…`l7`, `d1`), so the client only ever sees a stable hash of them.
 */
export function parsonsPublicId(authoredId: string): string {
  const hash = seedFromString(`parsons-block:${authoredId}`) & 0xffffffffffn;
  return `b${hash.toString(36).padStart(8, '0')}`;
}

interface Block {
  id: string;
  publicId: string;
  code: string;
  /** Key for comparing positions: blocks with the same code are interchangeable. */
  key: string;
  distractor: boolean;
  misconception?: string;
}

function blocksOf(spec: ParsonsSpec): Map<string, Block> {
  const blocks = new Map<string, Block>();
  for (const line of spec.lines) {
    const publicId = parsonsPublicId(line.id);
    blocks.set(publicId, {
      id: line.id,
      publicId,
      code: line.code,
      key: line.code.trim(),
      distractor: false,
    });
  }
  for (const d of spec.distractors) {
    const publicId = parsonsPublicId(d.id);
    const block: Block = {
      id: d.id,
      publicId,
      code: d.code,
      key: d.code.trim(),
      distractor: true,
    };
    if (d.misconception !== undefined) block.misconception = d.misconception;
    blocks.set(publicId, block);
  }
  return blocks;
}

/** One accepted program: line keys and indents in order. */
interface Target {
  keys: string[];
  indents: number[];
}

function targetsOf(spec: ParsonsSpec): Target[] {
  const byId = new Map(spec.lines.map((l) => [l.id, l]));
  const orders = [spec.lines.map((l) => l.id), ...spec.alternatives];
  return orders.map((order) => {
    const lines = order.map((id) => byId.get(id)).filter((l) => l !== undefined);
    return { keys: lines.map((l) => l.code.trim()), indents: lines.map((l) => l.indent) };
  });
}

/** Learner code from an answer: each known block on its own line, indented. */
export function assembleParsons(spec: ParsonsSpec, answer: ParsonsAnswer): string {
  const blocks = blocksOf(spec);
  return answer.order
    .flatMap((item) => {
      const block = blocks.get(item.id);
      return block ? [' '.repeat(item.indent * PARSONS_INDENT_WIDTH) + block.code.trim()] : [];
    })
    .join('\n');
}

/** The correct program (reference answer), as an answer of public IDs. */
export function parsonsReferenceAnswer(
  spec: ParsonsSpec,
  order: readonly string[] = spec.lines.map((l) => l.id),
): ParsonsAnswer {
  const byId = new Map(spec.lines.map((l) => [l.id, l]));
  return {
    order: order.map((id) => ({ id: parsonsPublicId(id), indent: byId.get(id)?.indent ?? 0 })),
  };
}

/** Longest common subsequence of two key lists: matched index pairs, in order. */
function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Array<number>(rows * cols).fill(0);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

const blockTarget = (publicId: string) => `block:${publicId}`;

export const parsons: ExerciseTypeDef<ParsonsSpec, ParsonsPublicSpec, ParsonsAnswer> = {
  id: 'parsons',
  version: VERSION,
  category: 'recall',
  specSchema: parsonsSpecSchema,
  publicSpecSchema: parsonsPublicSpecSchema,
  answerSchema: parsonsAnswerSchema,
  requiresRun: (spec) => spec.checks !== undefined,

  redact(spec, options = {}) {
    const blocks = [...spec.lines, ...spec.distractors].map((b) => ({
      id: parsonsPublicId(b.id),
      code: b.code.trim(),
    }));
    // Always shuffled (a missing seed must not reveal the order), and never left correct.
    const rng = createRng(seedFromString(`parsons:${options.shuffleSeed ?? ''}`));
    let shuffled = rng.shuffle(blocks);
    const solved = spec.lines.map((l) => l.code.trim()).join('\n');
    const prefix = () =>
      shuffled
        .slice(0, spec.lines.length)
        .map((b) => b.code)
        .join('\n');
    if (prefix() === solved && new Set(spec.lines.map((l) => l.code.trim())).size > 1) {
      shuffled = [...shuffled.slice(1), ...shuffled.slice(0, 1)];
    }
    const out: ParsonsPublicSpec = { blocks: shuffled, gradeIndent: spec.gradeIndent };
    if (spec.checks) {
      if (spec.entry !== undefined) out.entry = spec.entry;
      out.checks = spec.checks.map(redactCheck);
    }
    return out;
  },

  buildRunPlan(spec, answer, options) {
    return buildCheckRunPlan({
      mode: 'js-console',
      files: [{ path: 'main.js', language: 'js', content: assembleParsons(spec, answer) }],
      entry: 'main.js',
      checks: spec.checks ?? [],
      options,
      ...(spec.entry === undefined ? {} : { functionName: spec.entry }),
    });
  },

  grade({ spec, answer, run, serverFindings }) {
    const blocks = blocksOf(spec);
    const used = answer.order.flatMap((item) => {
      const block = blocks.get(item.id);
      return block ? [{ block, indent: item.indent }] : [];
    });
    const unknown = used.length !== answer.order.length;
    const distractorMisconceptions = used
      .filter((u) => u.block.distractor)
      .map((u) => u.block.misconception);

    if (spec.checks) {
      return gradeWithChecks({
        typeId: 'parsons',
        version: VERSION,
        checks: spec.checks,
        run,
        serverFindings,
        functionName: spec.entry,
        extraMisconceptions: distractorMisconceptions,
      });
    }

    // Order grading: the best of the correct order and the alternatives.
    const keys = used.map((u) => u.block.key);
    let best = { credit: -1, exact: false, total: 1, pairs: [] as [number, number][], target: 0 };
    targetsOf(spec).forEach((target, t) => {
      const pairs = lcsPairs(keys, target.keys);
      const indentOk = ([i, j]: [number, number]) =>
        !spec.gradeIndent || used[i]?.indent === target.indents[j];
      const credit = pairs.reduce((sum, p) => sum + (indentOk(p) ? 1 : WRONG_INDENT_CREDIT), 0);
      const exact =
        !unknown &&
        keys.length === target.keys.length &&
        pairs.length === target.keys.length &&
        pairs.every(indentOk);
      if (credit > best.credit || (exact && !best.exact)) {
        best = {
          credit,
          exact,
          total: Math.max(target.keys.length, keys.length),
          pairs,
          target: t,
        };
      }
    });
    const target = targetsOf(spec)[best.target] ?? { keys: [], indents: [] };

    const feedback: FeedbackItem[] = [];
    if (best.exact) {
      feedback.push({ level: 'success', code: 'PARSONS_CORRECT', message: '정답입니다.' });
    } else {
      const placed = new Set(best.pairs.map(([i]) => i));
      const missing = target.keys.length - best.pairs.length;
      const misplaced = used.filter((u, i) => !placed.has(i) && !u.block.distractor).length;
      const indentWrong = best.pairs.filter(
        ([i, j]) => spec.gradeIndent && used[i]?.indent !== target.indents[j],
      );
      if (unknown) {
        feedback.push({
          level: 'error',
          code: 'PARSONS_UNKNOWN_BLOCK',
          message: '문제에 없는 조각이 있습니다.',
        });
      }
      if (used.some((u) => u.block.distractor)) {
        feedback.push({
          level: 'error',
          code: 'PARSONS_DISTRACTOR',
          message: '필요 없는 줄이 들어 있습니다.',
        });
      }
      if (misplaced > 0) {
        feedback.push({
          level: 'error',
          code: 'PARSONS_ORDER',
          message: '순서가 맞지 않는 줄이 있습니다.',
        });
      }
      if (missing > misplaced) {
        feedback.push({ level: 'error', code: 'PARSONS_MISSING', message: '빠진 줄이 있습니다.' });
      }
      if (indentWrong.length > 0) {
        feedback.push({
          level: 'error',
          code: 'PARSONS_INDENT',
          message: '들여쓰기가 맞지 않는 줄이 있습니다.',
        });
      }
      // Lines in the right relative order are marked; the correct positions are never told.
      for (const [i, j] of best.pairs) {
        const u = used[i];
        if (!u) continue;
        const indentOk = !spec.gradeIndent || u.indent === target.indents[j];
        feedback.push(
          indentOk
            ? {
                level: 'success',
                code: 'PARSONS_IN_PLACE',
                message: '제자리에 있어요.',
                target: blockTarget(u.block.publicId),
              }
            : {
                level: 'error',
                code: 'PARSONS_INDENT_WRONG',
                message: '순서는 맞지만 들여쓰기가 달라요.',
                target: blockTarget(u.block.publicId),
              },
        );
      }
    }
    return buildResult({
      typeId: 'parsons',
      version: VERSION,
      correct: best.exact,
      score: best.total === 0 ? 0 : Math.max(0, best.credit) / best.total,
      feedback,
      misconceptionIds: best.exact ? [] : distractorMisconceptions,
    });
  },

  leakFingerprints(spec) {
    // Single blocks are public; the answer is their order, so fingerprint sequences.
    const lines = spec.lines.map((l) => normalizeLeakText(l.code)).filter((l) => l !== '');
    const pairs = lines
      .slice(1)
      .map((line, i) => `${lines[i] ?? ''} ${line}`)
      .filter((pair) => pair.length >= 12);
    return leakSet([lines.join(' '), ...pairs]);
  },

  verify(spec) {
    const issues: VerifyIssue[] = spec.checks
      ? verifyChecks(spec.checks, { allowDom: false, hasEntry: spec.entry !== undefined })
      : [];
    if (spec.entry !== undefined && !spec.checks) {
      issues.push({
        severity: 'warning',
        code: 'PARSONS_ENTRY_WITHOUT_CHECKS',
        message: 'entry는 checks가 있을 때만 쓰입니다.',
        path: 'entry',
      });
    }
    const lineKeys = new Set(spec.lines.map((l) => l.code.trim()));
    spec.distractors.forEach((d, index) => {
      if (lineKeys.has(d.code.trim())) {
        issues.push({
          severity: 'error',
          code: 'PARSONS_DISTRACTOR_IS_LINE',
          message: '방해 줄이 정답 줄과 같은 코드라 구별할 수 없습니다.',
          path: `distractors.${index}.code`,
        });
      }
    });
    if (spec.checks && spec.alternatives.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'PARSONS_ALTERNATIVES_WITH_CHECKS',
        message:
          'checks가 있으면 동작이 같은 다른 순서는 자동으로 정답입니다. alternatives는 실행 검증에만 쓰입니다.',
        path: 'alternatives',
      });
    }
    if (spec.checks && spec.gradeIndent && spec.lines.some((l) => l.indent > 0)) {
      issues.push({
        severity: 'warning',
        code: 'PARSONS_INDENT_NOT_GRADED_WITH_CHECKS',
        message: 'checks로 채점하면 들여쓰기는 채점하지 않습니다(JavaScript 동작에 영향이 없음).',
        path: 'gradeIndent',
      });
    }
    return issues;
  },
};
