import type { CheckKind, PublicCheck } from '@proginone/exercise-kit';

/** Fallback names when a check has no `description`. */
export const CHECK_KIND_LABELS: Readonly<Record<CheckKind, string>> = {
  call: '함수 호출 테스트',
  console: '콘솔 출력',
  program: '프로그램 결과',
  dom: 'HTML 구조',
  event: '이벤트 동작',
  css: 'CSS 스타일',
  layout: '레이아웃',
  a11y: '접근성',
  'html-valid': 'HTML 문법',
  static: '코드 규칙',
};

/** Title of a check row: its description, or a kind label. */
export function checkTitle(check: PublicCheck): string {
  const description = check['description'];
  return typeof description === 'string' && description !== ''
    ? description
    : CHECK_KIND_LABELS[check.kind];
}

/**
 * One-line code summary of a visible check's input and expectation, e.g. `sumEven([1, 2]) → 2`.
 * Returns `null` for hidden checks (their expectations are redacted) and kinds without a compact
 * form; those rows show only the description.
 */
export function checkSummary(check: PublicCheck, entry?: string): string | null {
  if (!check.visible) return null;
  if (check.kind === 'call') return callSummary(check, entry ?? 'f');
  if (check.kind === 'console') {
    const expect = asRecord(check['expect']);
    const lines = expect?.['lines'];
    if (!Array.isArray(lines)) return null;
    return lines.map(String).join('\n');
  }
  return null;
}

function callSummary(check: PublicCheck, entry: string): string {
  const argsExpr = check['argsExpr'];
  const args = Array.isArray(check['args']) ? (check['args'] as unknown[]) : [];
  const call = `${entry}(${typeof argsExpr === 'string' ? argsExpr : args.map(formatJson).join(', ')})`;
  const expect = asRecord(check['expect']);
  if (!expect) return call;
  if ('equals' in expect) return `${call} → ${formatJson(expect['equals'])}`;
  if ('strictEquals' in expect) return `${call} → ${formatJson(expect['strictEquals'])}`;
  if ('equalsLiteral' in expect) return `${call} → ${String(expect['equalsLiteral'])}`;
  if ('strictEqualsLiteral' in expect) return `${call} → ${String(expect['strictEqualsLiteral'])}`;
  if ('closeTo' in expect) {
    const closeTo = asRecord(expect['closeTo']);
    return `${call} → ≈ ${formatJson(closeTo?.['value'])}`;
  }
  if ('throws' in expect) {
    const name = asRecord(expect['throws'])?.['name'];
    return `${call} → ${typeof name === 'string' ? name : '오류'} 발생`;
  }
  if ('argsUnchanged' in expect) return `${call} · 인자를 바꾸지 않아요`;
  if ('returnsNewReference' in expect) return `${call} · 새 값을 반환해요`;
  if ('matches' in expect) return `${call} → ${describeMatches(asRecord(expect['matches']))}`;
  return call;
}

function describeMatches(matches: Record<string, unknown> | null): string {
  if (!matches) return '조건 일치';
  const parts: string[] = [];
  if (typeof matches['type'] === 'string') parts.push(`${matches['type']} 값`);
  if (typeof matches['length'] === 'number') parts.push(`길이 ${matches['length']}`);
  if (Array.isArray(matches['contains']))
    parts.push(`${(matches['contains'] as unknown[]).map(formatJson).join(', ')} 포함`);
  return parts.join(', ');
}

/** Formats a JSON value like the ProgInOne console format (`[1, "a"]`, `{ a: 1 }`). */
export function formatJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(formatJson).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const body = entries
      .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${formatJson(v)}`)
      .join(', ');
    return `{ ${body} }`;
  }
  return typeof value === 'bigint' ? value.toString() : '';
}

/** Narrows `CheckResult.kind` (a plain string) to a known check kind. */
export function isCheckKind(kind: string): kind is CheckKind {
  return Object.hasOwn(CHECK_KIND_LABELS, kind);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
