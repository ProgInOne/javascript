import {
  A11Y_IMPACTS,
  consoleEntriesToLines,
  formatValue,
  type Observation,
  type ObservationOf,
  type ObservationOp,
  type Rect,
  type RunResult,
  type SerializedValue,
} from '@proginone/run-contract';

import { parseLiteral } from '../common/literal.ts';
import { normalizeOutputLines } from '../common/normalize.ts';
import { compareOutput, outputLineEquals } from '../common/output.ts';
import { diffValues, fromJson, toNumber, valuesEqual } from '../common/values.ts';
import type { CheckFailReason, CheckResult, ServerFindings } from '../core/types.ts';
import { globalNames, stepId } from './compile.ts';
import { cssValueMatches, describeComparator } from './css.ts';
import {
  isRequired,
  isVisible,
  type CallExpect,
  type Check,
  type CheckOf,
  type DomExpect,
  type ValueExpect,
} from './schema.ts';

/**
 * Compares sandbox observations with check expectations (the server half of the observation
 * model, docs/design/code-execution-sandbox.md#관측-모델). Pure; tolerant of missing or forged
 * observations (they fail the check, never throw).
 */

interface Verdict {
  passed: boolean;
  reason?: CheckFailReason;
  detail?: { path?: string; expected?: string; actual?: string };
}

const PASS: Verdict = { passed: true };
const fail = (reason: CheckFailReason, detail?: Verdict['detail']): Verdict =>
  detail ? { passed: false, reason, detail } : { passed: false, reason };

/** Observation lookup by step ID. The first observation with an ID wins (duplicates are ignored). */
export class ObservationIndex {
  private readonly byId = new Map<string, Observation>();

  constructor(observations: readonly Observation[]) {
    for (const o of observations) if (!this.byId.has(o.id)) this.byId.set(o.id, o);
  }

  get<Op extends ObservationOp>(id: string, op: Op): ObservationOf<Op> | Verdict {
    const o = this.byId.get(id);
    if (o?.op !== op) return fail('NOT_OBSERVED');
    if (o.status === 'timeout') return fail('STEP_TIMEOUT');
    if (o.status === 'error' || o.status === 'skipped') {
      return fail(
        'STEP_ERROR',
        o.error ? { actual: `${o.error.name}: ${o.error.message}` } : undefined,
      );
    }
    return o as ObservationOf<Op>;
  }
}

function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'object' && value !== null && 'passed' in value;
}

export interface EvaluateContext {
  run: RunResult;
  serverFindings?: ServerFindings;
}

/** Evaluates every check. Results keep the check order. */
export function evaluateChecks(checks: readonly Check[], ctx: EvaluateContext): CheckResult[] {
  const index = new ObservationIndex(ctx.run.observations);
  return checks.map((check) => {
    const verdict = evaluate(check, index, ctx);
    const visible = isVisible(check);
    const result: CheckResult = {
      id: check.id,
      kind: check.kind,
      passed: verdict.passed,
      required: isRequired(check),
      weight: check.weight,
      visible,
    };
    if (check.description !== undefined) result.description = check.description;
    if (check.requirement !== undefined) result.requirement = check.requirement;
    if (!verdict.passed) {
      if (verdict.reason) result.reason = verdict.reason;
      // Hidden expectations stay on the server: only visible checks carry expected/actual.
      if (visible && verdict.detail) result.detail = verdict.detail;
      if (check.misconceptionIfFail !== undefined)
        result.misconceptionId = check.misconceptionIfFail;
    }
    return result;
  });
}

function evaluate(check: Check, index: ObservationIndex, ctx: EvaluateContext): Verdict {
  switch (check.kind) {
    case 'call':
      return evaluateCall(check, index);
    case 'console':
      return evaluateConsole(check, index);
    case 'program':
      return evaluateProgram(check, index, ctx.run);
    case 'dom':
      return evaluateDomExpect(stepId(check.id, 'q'), check.expect, index);
    case 'event':
      return evaluateEvent(check, index);
    case 'css':
      return evaluateCss(check, index);
    case 'layout':
      return evaluateLayout(check, index);
    case 'a11y':
      return evaluateA11y(check, index);
    case 'html-valid':
    case 'static': {
      const finding =
        ctx.serverFindings && Object.hasOwn(ctx.serverFindings, check.id)
          ? ctx.serverFindings[check.id]
          : undefined;
      if (!finding) return fail('NOT_OBSERVED');
      if (finding.passed) return PASS;
      return fail(
        'VIOLATION',
        finding.messages?.length ? { actual: finding.messages.join('; ') } : undefined,
      );
    }
  }
}

// ── values ──────────────────────────────────────────────────────────────────

function expectedValue(expect: ValueExpect): { value: SerializedValue; strict: boolean } | null {
  if ('equals' in expect) return { value: fromJson(expect.equals), strict: false };
  if ('strictEquals' in expect) return { value: fromJson(expect.strictEquals), strict: true };
  if ('equalsLiteral' in expect || 'strictEqualsLiteral' in expect) {
    const text = 'equalsLiteral' in expect ? expect.equalsLiteral : expect.strictEqualsLiteral;
    const value = parseLiteral(text);
    return value ? { value, strict: 'strictEqualsLiteral' in expect } : null;
  }
  return null;
}

function typeOf(value: SerializedValue): string {
  switch (value.t) {
    case 'array':
      return 'array';
    case 'object':
    case 'map':
    case 'set':
    case 'date':
    case 'regexp':
    case 'error':
    case 'dom':
      return 'object';
    default:
      return value.t;
  }
}

/** Compares an observed value with a value expectation. */
export function matchValue(expect: ValueExpect, actual: SerializedValue): Verdict {
  const expected = expectedValue(expect);
  if (expected) {
    const diff = diffValues(expected.value, actual, { strict: expected.strict });
    if (!diff) return PASS;
    const reason: CheckFailReason = diff.reason === 'MISMATCH' ? 'MISMATCH' : diff.reason;
    return fail(reason, { path: diff.path, expected: diff.expected, actual: diff.actual });
  }
  if ('closeTo' in expect) {
    const ok =
      actual.t === 'number' &&
      Math.abs(toNumber(actual.v) - expect.closeTo.value) <= expect.closeTo.epsilon;
    return ok
      ? PASS
      : fail('MISMATCH', { expected: `≈ ${expect.closeTo.value}`, actual: formatValue(actual) });
  }
  if ('matches' in expect) {
    const m = expect.matches;
    if (m.type !== undefined && typeOf(actual) !== m.type) {
      return fail('MISMATCH', { expected: `${m.type} 형식`, actual: formatValue(actual) });
    }
    if (m.length !== undefined) {
      const length =
        actual.t === 'array'
          ? actual.length
          : actual.t === 'string' && !actual.truncated
            ? actual.v.length
            : null;
      if (length !== m.length) {
        return fail('MISMATCH', {
          path: '.length',
          expected: String(m.length),
          actual: length === null ? formatValue(actual) : String(length),
        });
      }
    }
    if (m.contains !== undefined) {
      if (actual.t !== 'array')
        return fail('MISMATCH', { expected: '배열', actual: formatValue(actual) });
      for (const item of m.contains) {
        const sv = fromJson(item);
        if (!actual.items.some((x) => valuesEqual(sv, x))) {
          return fail('MISMATCH', {
            expected: `${formatValue(sv)} 포함`,
            actual: formatValue(actual),
          });
        }
      }
    }
    return PASS;
  }
  return fail('MISMATCH');
}

// ── call ────────────────────────────────────────────────────────────────────

function evaluateCall(check: CheckOf<'call'>, index: ObservationIndex): Verdict {
  const obs = index.get(stepId(check.id, 0), 'callFunction');
  if (isVerdict(obs)) return obs;
  if (obs.outcome === 'missing') return fail('MISSING_IDENTIFIER');
  if (obs.outcome === 'not_callable') return fail('NOT_CALLABLE');
  const expect: CallExpect = check.expect;
  const thrownText = obs.thrown ? describeThrown(obs.thrown) : 'Error';

  if ('throws' in expect) {
    if (obs.outcome !== 'threw') {
      return fail('DID_NOT_THROW', {
        expected: `${expect.throws.name ?? '오류'} 발생`,
        actual: obs.value ? formatValue(obs.value) : '반환',
      });
    }
    const thrown = obs.thrown;
    const name = thrown?.t === 'error' ? thrown.name : undefined;
    const message = thrown?.t === 'error' ? thrown.message : '';
    if (expect.throws.name !== undefined && name !== expect.throws.name) {
      return fail('MISMATCH', { expected: expect.throws.name, actual: thrownText });
    }
    if (
      expect.throws.messageIncludes !== undefined &&
      !message.includes(expect.throws.messageIncludes)
    ) {
      return fail('MISMATCH', {
        expected: `메시지에 "${expect.throws.messageIncludes}" 포함`,
        actual: thrownText,
      });
    }
    return PASS;
  }
  if (obs.outcome === 'threw') return fail('THREW', { actual: thrownText });
  if (!obs.value) return fail('NOT_OBSERVED');

  if ('argsUnchanged' in expect) {
    if (!obs.argsAfter) return fail('NOT_OBSERVED');
    for (const [i, arg] of check.args.entries()) {
      const after = obs.argsAfter[i];
      const diff = after
        ? diffValues(fromJson(arg), after)
        : { path: '', expected: '', actual: '(없음)' };
      if (diff) {
        return fail('MUTATED_ARGS', {
          path: `인수[${i}]${diff.path}`,
          expected: diff.expected,
          actual: diff.actual,
        });
      }
    }
    return PASS;
  }
  if ('returnsNewReference' in expect) {
    if (!obs.returnIsArg) return fail('NOT_OBSERVED');
    return obs.returnIsArg.length === 0 ? PASS : fail('SAME_REFERENCE');
  }
  return matchValue(expect, obs.value);
}

function describeThrown(value: SerializedValue): string {
  return value.t === 'error' ? `${value.name}: ${value.message}` : formatValue(value);
}

// ── console / program ───────────────────────────────────────────────────────

function evaluateConsole(check: CheckOf<'console'>, index: ObservationIndex): Verdict {
  const obs = index.get(stepId(check.id, 0), 'consoleOutput');
  if (isVerdict(obs)) return obs;
  const actualLines = normalizeOutputLines(consoleEntriesToLines(obs.entries).join('\n'));
  const expected = normalizeOutputLines(check.expect.lines.join('\n'));
  const { mode, allowExtraTrailing } = check.expect;

  if (mode === 'exact') {
    const actual = allowExtraTrailing ? actualLines.slice(0, expected.length) : actualLines;
    const cmp = compareOutput(expected, actual.join('\n'));
    if (cmp.equal) return PASS;
    const i = cmp.matches.indexOf(false);
    return fail('MISMATCH', {
      path: `${i + 1}번째 줄`,
      expected: cmp.expected[i] ?? '(없음)',
      actual: cmp.actual[i] ?? '(없음)',
    });
  }
  if (mode === 'contains') {
    const missing = expected.find((line) => !actualLines.some((a) => outputLineEquals(line, a)));
    return missing === undefined
      ? PASS
      : fail('MISMATCH', { expected: `${missing} 출력`, actual: actualLines.join('\n') });
  }
  // ordered-subset: expected lines appear in this order (other lines may come between).
  let at = 0;
  for (const line of actualLines)
    if (at < expected.length && outputLineEquals(expected[at] ?? '', line)) at++;
  return at === expected.length
    ? PASS
    : fail('MISMATCH', {
        expected: `${expected[at] ?? ''} 출력(순서대로)`,
        actual: actualLines.join('\n'),
      });
}

function evaluateProgram(
  check: CheckOf<'program'>,
  index: ObservationIndex,
  run: RunResult,
): Verdict {
  if (check.expect.noError === true) {
    const error = run.errors.find(
      (e) => e.phase === 'runtime' || e.phase === 'unhandled_rejection',
    );
    if (error) return fail('THREW', { actual: `${error.name}: ${error.message}` });
  }
  const globals = check.expect.globals ?? {};
  for (const [i, name] of globalNames(check).entries()) {
    const expect = globals[name];
    if (!expect) continue;
    const obs = index.get(stepId(check.id, i), 'readGlobal');
    if (isVerdict(obs)) return obs;
    if (obs.outcome === 'missing' || !obs.value) return fail('MISSING_IDENTIFIER', { path: name });
    const verdict = matchValue(expect, obs.value);
    if (!verdict.passed)
      return {
        ...verdict,
        detail: { ...verdict.detail, path: `${name}${verdict.detail?.path ?? ''}` },
      };
  }
  return PASS;
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function normalizeText(text: string, trim: boolean, caseSensitive: boolean): string {
  const t = trim ? text.trim().replace(/\s+/g, ' ') : text;
  return caseSensitive ? t : t.toLowerCase();
}

/** Evaluates one DOM expectation against the steps produced by `compileDomExpect(prefix, …)`. */
export function evaluateDomExpect(
  prefix: string,
  expect: DomExpect,
  index: ObservationIndex,
): Verdict {
  const obs = index.get(prefix, 'domQuery');
  if (isVerdict(obs)) return obs;
  const count = obs.count;

  if (expect.exists !== undefined && count > 0 !== expect.exists) {
    return fail(expect.exists ? 'NOT_FOUND' : 'MISMATCH', {
      expected: expect.exists ? '있음' : '없음',
      actual: `${count}개`,
    });
  }
  if (expect.count !== undefined) {
    const c = expect.count;
    const ok =
      typeof c === 'number'
        ? count === c
        : (c.min === undefined || count >= c.min) && (c.max === undefined || count <= c.max);
    if (!ok) {
      const exp = typeof c === 'number' ? `${c}개` : `${c.min ?? 0}~${c.max ?? '∞'}개`;
      return fail('MISMATCH', { path: '개수', expected: exp, actual: `${count}개` });
    }
  }
  // Per-element reads come back as `items`. `parentSelector` and `order` are answered by their own
  // steps, and a main query that reads only `count` has no items (harness `domQuery`), so those
  // two need a matched element but not items.
  const needsItems =
    expect.text !== undefined ||
    expect.attr !== undefined ||
    expect.tag !== undefined ||
    expect.value !== undefined ||
    expect.checked !== undefined;
  const needsElement =
    needsItems || expect.parentSelector !== undefined || expect.order !== undefined;
  if (!needsElement) return PASS;
  if (count === 0 || (needsItems && obs.items.length === 0)) return fail('NOT_FOUND');

  const all = expect.all;
  const firstOnly = obs.items.slice(0, 1);
  if (expect.text) {
    const t = expect.text;
    for (const item of t.all || all ? obs.items : firstOnly) {
      const actual = normalizeText(item.text ?? '', t.trim, t.caseSensitive);
      if (t.equals !== undefined && actual !== normalizeText(t.equals, t.trim, t.caseSensitive)) {
        return fail('MISMATCH', { path: '텍스트', expected: t.equals, actual: item.text ?? '' });
      }
      if (
        t.includes !== undefined &&
        !actual.includes(normalizeText(t.includes, t.trim, t.caseSensitive))
      ) {
        return fail('MISMATCH', {
          path: '텍스트',
          expected: `"${t.includes}" 포함`,
          actual: item.text ?? '',
        });
      }
    }
  }
  const scope = all ? obs.items : firstOnly;
  if (expect.attr) {
    const a = expect.attr;
    for (const item of scope) {
      const value =
        item.attrs && Object.hasOwn(item.attrs, a.name) ? (item.attrs[a.name] ?? null) : null;
      const path = `${a.name} 속성`;
      if (a.present !== undefined && (value !== null) !== a.present) {
        return fail('MISMATCH', {
          path,
          expected: a.present ? '있음' : '없음',
          actual: value ?? '없음',
        });
      }
      if (a.notEmpty && (value === null || value.trim() === '')) {
        return fail('MISMATCH', { path, expected: '비어 있지 않음', actual: value ?? '없음' });
      }
      if (a.equals !== undefined && value !== a.equals)
        return fail('MISMATCH', { path, expected: a.equals, actual: value ?? '없음' });
    }
  }
  for (const item of scope) {
    if (expect.tag !== undefined && item.tagName?.toLowerCase() !== expect.tag.toLowerCase()) {
      return fail('MISMATCH', { path: '태그', expected: expect.tag, actual: item.tagName ?? '' });
    }
    if (expect.value !== undefined && item.value !== expect.value) {
      return fail('MISMATCH', { path: '값', expected: expect.value, actual: item.value ?? '' });
    }
    if (expect.checked !== undefined && item.checked !== expect.checked) {
      return fail('MISMATCH', {
        path: 'checked',
        expected: String(expect.checked),
        actual: String(item.checked),
      });
    }
  }
  if (expect.parentSelector !== undefined) {
    const parent = index.get(`${prefix}.parent`, 'domQuery');
    if (isVerdict(parent)) return parent;
    if (parent.count !== count)
      return fail('MISMATCH', {
        path: '부모 요소',
        expected: expect.parentSelector,
        actual: `${parent.count}/${count}개 일치`,
      });
  }
  if (expect.order !== undefined) {
    const children = index.get(`${prefix}.order`, 'domQuery');
    if (isVerdict(children)) return children;
    const wanted = expect.order.map((t) => t.toLowerCase());
    const tags = children.items
      .map((i) => i.tagName?.toLowerCase() ?? '')
      .filter((t) => wanted.includes(t));
    let at = 0;
    for (const tag of tags) if (tag === wanted[at]) at++;
    if (at !== wanted.length)
      return fail('MISMATCH', {
        path: '자식 순서',
        expected: wanted.join(' → '),
        actual: tags.join(' → '),
      });
  }
  return PASS;
}

function evaluateEvent(check: CheckOf<'event'>, index: ObservationIndex): Verdict {
  for (const [i, step] of check.steps.entries()) {
    if (step.action === 'wait') continue;
    const obs = index.get(stepId(check.id, `s${i}`), 'dispatch');
    if (isVerdict(obs)) return obs;
    if (!obs.ok) {
      return obs.reason === 'TARGET_NOT_FOUND'
        ? fail('NOT_FOUND', { path: step.selector })
        : fail(
            'THREW',
            obs.error ? { actual: `${obs.error.name}: ${obs.error.message}` } : undefined,
          );
    }
  }
  for (const [i, expect] of check.expect.entries()) {
    const verdict = evaluateDomExpect(stepId(check.id, `e${i}`), expect, index);
    if (!verdict.passed)
      return {
        ...verdict,
        detail: {
          ...verdict.detail,
          path: `${expect.selector} ${verdict.detail?.path ?? ''}`.trim(),
        },
      };
  }
  return PASS;
}

// ── CSS / layout / a11y ─────────────────────────────────────────────────────

function evaluateCss(check: CheckOf<'css'>, index: ObservationIndex): Verdict {
  const obs = index.get(stepId(check.id, 0), 'computedStyle');
  if (isVerdict(obs)) return obs;
  if (obs.count === 0 || obs.elements.length === 0)
    return fail('NOT_FOUND', { path: check.selector });
  const elements = check.all ? obs.elements : obs.elements.slice(0, 1);
  for (const element of elements) {
    for (const [property, comparator] of Object.entries(check.expect.computed)) {
      const observed = Object.hasOwn(element, property) ? element[property] : undefined;
      if (observed === undefined) return fail('NOT_OBSERVED', { path: property });
      if (!cssValueMatches(comparator, observed)) {
        return fail('MISMATCH', {
          path: property,
          expected: describeComparator(comparator),
          actual: observed,
        });
      }
    }
  }
  return PASS;
}

function evaluateLayout(check: CheckOf<'layout'>, index: ObservationIndex): Verdict {
  const obs = index.get(stepId(check.id, 0), 'boxRect');
  if (isVerdict(obs)) return obs;
  const rectOf = (selector: string | undefined): Rect | undefined =>
    selector === undefined
      ? undefined
      : obs.rects.find((r) => r.selector === selector && r.count > 0)?.rect;
  const a = rectOf(check.a);
  const b = rectOf(check.b);
  const container = rectOf(check.container);
  if (!a) return fail('NOT_FOUND', { path: check.a });
  const tol = check.tolerancePx;

  if (check.gap) {
    if (!b) return fail('NOT_FOUND', { path: check.b ?? '' });
    const gap = check.gap.axis === 'x' ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
    const ok =
      (check.gap.min === undefined || gap >= check.gap.min - tol) &&
      (check.gap.max === undefined || gap <= check.gap.max + tol);
    return ok
      ? PASS
      : fail('MISMATCH', {
          path: '간격',
          expected: `${check.gap.min ?? 0}~${check.gap.max ?? '∞'}px`,
          actual: `${round(gap)}px`,
        });
  }

  const other =
    check.relation === 'inside'
      ? (b ?? container)
      : ['centered-horizontally', 'centered-vertically', 'fills-width'].includes(
            check.relation ?? '',
          )
        ? container
        : b;
  if (!other) return fail('NOT_FOUND', { path: check.b ?? check.container ?? '' });
  const ok = relationHolds(check.relation ?? 'left-of', a, other, tol);
  return ok ? PASS : fail('MISMATCH', { path: check.relation ?? '' });
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function relationHolds(relation: string, a: Rect, b: Rect, tol: number): boolean {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  switch (relation) {
    case 'left-of':
      return aRight <= b.x + tol;
    case 'right-of':
      return a.x >= bRight - tol;
    case 'above':
      return aBottom <= b.y + tol;
    case 'below':
      return a.y >= bBottom - tol;
    case 'inside':
      return (
        a.x >= b.x - tol && a.y >= b.y - tol && aRight <= bRight + tol && aBottom <= bBottom + tol
      );
    case 'same-row':
      return a.y < bBottom - tol && b.y < aBottom - tol;
    case 'same-column':
      return a.x < bRight - tol && b.x < aRight - tol;
    case 'centered-horizontally':
      return Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) <= tol;
    case 'centered-vertically':
      return Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) <= tol;
    case 'fills-width':
      return Math.abs(a.width - b.width) <= tol;
    default:
      return false;
  }
}

function evaluateA11y(check: CheckOf<'a11y'>, index: ObservationIndex): Verdict {
  const obs = index.get(stepId(check.id, 0), 'a11y');
  if (isVerdict(obs)) return obs;
  const threshold = A11Y_IMPACTS.indexOf(check.impact);
  const rules = check.rules ? new Set(check.rules) : null;
  const violations = obs.violations.filter(
    (v) =>
      (rules === null || rules.has(v.ruleId)) &&
      A11Y_IMPACTS.indexOf(v.impact ?? 'minor') >= threshold,
  );
  if (violations.length === 0) return PASS;
  return fail('VIOLATION', { actual: [...new Set(violations.map((v) => v.ruleId))].join(', ') });
}
