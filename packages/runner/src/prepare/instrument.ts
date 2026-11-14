import { parse } from 'acorn';

/**
 * Loop guard instrumentation (docs/design/code-execution-sandbox.md#dom-모드의-반복문-계측-loop-guard).
 *
 * Every loop becomes
 *
 *     {let __pgL1=__pg.enter(sourceId,line,col); while (c) {__pg.tick(__pgL1); body}}
 *
 * `__pg.tick` throws a harness-only error once the loop has spun for `loopBudgetMs`. Nothing is
 * inserted as a new line, so line numbers stay the same; the inserted text is recorded so that
 * columns can be mapped back.
 *
 * This only parses learner code, it never runs it.
 *
 * Strict mode (D-026): with `strict`, {@link STRICT_PREFIX} is put in front of line 1 (no newline)
 * so that learner code runs as strict-mode code, like modules and classes. The prefix is parsed
 * too, so strict-only syntax errors (`with`, octal literals, duplicate parameters, ...) are found
 * here with learner positions, and it is recorded as an insertion at line 1, column 0 so that
 * {@link originalColumn} maps columns back like any guard text.
 */

/** Directive prepended to learner scripts and inline handlers (single quotes: attribute-safe). */
export const STRICT_PREFIX = "'use strict';";

const LOOP_TYPES = new Set([
  'ForStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
]);

/** Text inserted at an original position. Line is 1-based, column 0-based (acorn convention). */
export interface Insertion {
  line: number;
  column: number;
  length: number;
}

export interface LearnerSyntaxError {
  message: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

export type InstrumentResult =
  | { ok: true; code: string; loops: number; insertions: Insertion[] }
  | { ok: false; error: LearnerSyntaxError };

interface AstNode {
  type: string;
  start: number;
  end: number;
}

interface LoopNode extends AstNode {
  body: AstNode;
}

const isNode = (v: unknown): v is AstNode =>
  typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';

/** Offsets of the first character of every line. */
function lineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    const ch = code.charCodeAt(i);
    // \n, \r (not followed by \n), U+2028, U+2029: the line terminators JavaScript counts.
    if (ch === 10 || ch === 0x2028 || ch === 0x2029) starts.push(i + 1);
    else if (ch === 13 && code.charCodeAt(i + 1) !== 10) starts.push(i + 1);
  }
  return starts;
}

function locate(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (starts[lo] ?? 0) };
}

/**
 * Inserts loop guards into a classic script.
 * @param options.sourceId reported back with a loop-limit position (`orig:<id>`).
 * @param options.handler parse as an inline event handler body (`return` allowed).
 * @returns the instrumented code, or the syntax error with a 1-based position.
 */
export function instrumentJs(
  code: string,
  options: { sourceId?: number; handler?: boolean; strict?: boolean } = {},
): InstrumentResult {
  const sourceId = options.sourceId ?? 0;
  const prefix = options.strict ? STRICT_PREFIX : '';
  /** AST offsets are in `prefix + code`; this many characters precede the learner's code. */
  const shift = prefix.length;
  let ast: unknown;
  try {
    ast = parse(prefix + code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: options.handler ?? false,
    });
  } catch (e) {
    const err = e as { message?: string; loc?: { line: number; column: number } };
    return {
      ok: false,
      error: {
        // acorn appends " (line:col)"; the position is reported separately.
        message: (err.message ?? 'SyntaxError').replace(/ \(\d+:\d+\)$/, ''),
        line: err.loc?.line ?? 1,
        column: Math.max(0, (err.loc?.column ?? 0) - ((err.loc?.line ?? 1) === 1 ? shift : 0)) + 1,
      },
    };
  }

  const edits: { pos: number; text: string; order: number }[] = [];
  let loops = 0;
  let order = 0;
  const starts = lineStarts(code);

  const visit = (node: AstNode, labelStart: number | undefined) => {
    if (LOOP_TYPES.has(node.type)) {
      const loop = node as LoopNode;
      const id = ++loops;
      const loopStart = loop.start - shift;
      const { line, column } = locate(starts, loopStart);
      const handle = `__pgL${id}`;
      const outer = labelStart ?? loopStart;
      const o = order++;
      // Wrapping outside the label keeps `continue label` / `break label` valid.
      edits.push({
        pos: outer,
        text: `{let ${handle}=__pg.enter(${sourceId},${line},${column});`,
        order: o,
      });
      edits.push({ pos: loop.end - shift, text: '}', order: o });
      const tick = `__pg.tick(${handle});`;
      const bodyStart = loop.body.start - shift;
      const bodyEnd = loop.body.end - shift;
      if (loop.body.type === 'BlockStatement') {
        edits.push({ pos: bodyStart + 1, text: tick, order: o });
      } else {
        edits.push({ pos: bodyStart, text: `{${tick}`, order: o });
        edits.push({ pos: bodyEnd, text: '}', order: o });
      }
    }
    const nextLabel =
      node.type === 'LabeledStatement' ? (labelStart ?? node.start - shift) : undefined;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, undefined);
      } else if (isNode(value)) {
        visit(value, key === 'body' ? nextLabel : undefined);
      }
    }
  };
  if (isNode(ast)) visit(ast, undefined);

  // Apply from the end. At the same position the inner loop (higher order) goes first, so the
  // outer loop's text ends up in front of it.
  edits.sort((a, b) => b.pos - a.pos || b.order - a.order);
  let out = code;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);

  const insertions = edits
    .map((e) => ({ ...locate(starts, e.pos), length: e.text.length }))
    .sort((a, b) => a.line - b.line || a.column - b.column);
  // The prefix sits in front of everything else on line 1 (stable sort keeps it first).
  if (prefix) insertions.unshift({ line: 1, column: 0, length: prefix.length });
  return { ok: true, code: prefix + out, loops, insertions };
}

/**
 * Maps a 1-based column in instrumented code back to the original line's column.
 * A position inside inserted guard text maps to where the text was inserted.
 */
export function originalColumn(insertions: readonly Insertion[], line: number, column: number) {
  let col0 = column - 1;
  let shift = 0;
  for (const ins of insertions) {
    if (ins.line !== line) continue;
    const at = ins.column + shift;
    if (col0 < at) break;
    if (col0 < at + ins.length) return ins.column + 1;
    shift += ins.length;
  }
  col0 -= shift;
  return col0 + 1;
}
