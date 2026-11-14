import type { CheckBundle } from '@proginone/shared';
import { parseExpressionAt } from 'acorn';
import { instrumentJs } from './instrument.ts';

/**
 * Expose script (docs/design/code-execution-sandbox.md#학습자-식별자-접근).
 *
 * Top-level `let`/`const`/`class` bindings are not properties of the global object, and `eval` is
 * blocked by the shell CSP. A separate classic script that runs after the learner's scripts shares
 * their global lexical environment and can hand the bindings to the harness. The same script
 * carries `callFunction.argsExpr` sources (content-authored argument expressions that JSON cannot
 * express, e.g. `[new Map([[1, 2]])]`), so no string is ever evaluated at run time.
 */

const RESERVED = new Set(
  (
    'await break case catch class const continue debugger default delete do else enum export ' +
    'extends false finally for function if implements import in instanceof interface let new ' +
    'null package private protected public return static super switch this throw true try ' +
    'typeof var void while with yield arguments eval undefined'
  ).split(' '),
);

const IDENT = /^[A-Za-z_$][\w$]{0,99}$/;

/** Learner identifiers to expose: the bundle's list plus every step's name, without duplicates. */
export function exposedNames(bundle: CheckBundle): string[] {
  const names = new Set(bundle.expose);
  for (const s of bundle.steps) {
    if (s.op === 'callFunction' || s.op === 'readGlobal') names.add(s.name);
  }
  return [...names];
}

export class ArgsExprError extends Error {
  readonly stepId: string;
  constructor(stepId: string, message: string) {
    super(message);
    this.name = 'ArgsExprError';
    this.stepId = stepId;
  }
}

/**
 * Checks that `source` is exactly one expression (so it cannot close the generated function and
 * add statements) and adds loop guards inside any functions it contains.
 * @throws ArgsExprError when it is not a single expression.
 */
function argsExpression(stepId: string, source: string): string {
  let end: number;
  try {
    end = parseExpressionAt(source, 0, { ecmaVersion: 'latest' }).end;
  } catch (e) {
    throw new ArgsExprError(stepId, (e as Error).message);
  }
  if (source.slice(end).trim() !== '') {
    throw new ArgsExprError(stepId, 'argsExpr는 식 하나여야 합니다.');
  }
  const guarded = instrumentJs(`(${source});`, { sourceId: 999_999 });
  if (!guarded.ok) throw new ArgsExprError(stepId, guarded.error.message);
  return guarded.code.replace(/;\s*$/, '');
}

/**
 * Builds the expose script, or `null` when there is nothing to expose.
 *
 * Each name gets a reader function defined in the learner's global scope, so steps that run later
 * (after events or timers) see the binding's current value. A reader returns `{s:0,v}` when the
 * binding exists, `{s:1}` when it is not declared and `{s:2}` while it is in its temporal dead
 * zone: reading either of the last two throws, and only the TDZ also throws on `typeof`.
 *
 * Each `argsExpr` becomes a function returning a fresh argument array per call.
 * @throws ArgsExprError for an `argsExpr` that is not a single expression.
 */
export function exposeScript(bundle: CheckBundle): string | null {
  const usable = exposedNames(bundle).filter((n) => IDENT.test(n) && !RESERVED.has(n));
  const args: string[] = [];
  for (const s of bundle.steps) {
    if (s.op === 'callFunction' && s.argsExpr !== undefined) {
      args.push(
        `__pgA[${JSON.stringify(s.id)}]=function(){return ${argsExpression(s.id, s.argsExpr)};};`,
      );
    }
  }
  if (usable.length === 0 && args.length === 0) return null;
  // Helper names start with __pg so they cannot shadow a learner binding such as `o` or `e`.
  const readers = usable.map(
    (n) =>
      `__pgO[${JSON.stringify(n)}]=function(){try{return{s:0,v:${n}};}catch(__pgE){` +
      `try{typeof ${n};return{s:1};}catch(__pgE2){return{s:2};}}};`,
  );
  return (
    `__pg.expose((function(){var __pgO={};${readers.join('')}return __pgO;})(),` +
    `(function(){var __pgA={};${args.join('')}return __pgA;})());`
  );
}
