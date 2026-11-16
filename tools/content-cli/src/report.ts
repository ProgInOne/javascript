/**
 * `content-cli report`: the per-unit quantity, type-mix and difficulty table of
 * content-and-exercises.md#문제-수-산정-방식 ("빌드 보고서"), for reviewers and content authors.
 */
import {
  CATEGORIES,
  CATEGORY_LABELS,
  findQuantityViolations,
  measureQuantities,
  QUANTITY_LEVELS,
  type QuantityViolation,
  type UnitQuantity,
} from './quantity.ts';
import type { ContentSource } from './load.ts';

export type ReportFormat = 'text' | 'markdown';

const KIND_LABELS: Record<UnitQuantity['kind'], string> = {
  lesson: '단원',
  assessment: '평가',
  project: '프로젝트',
};

/**
 * The 기준 column. An assessment's range is about the items one sitting asks, not the pool
 * (`승인`), so the row shows that number too: `출제 20 / 10~20` (D-070).
 */
function criterion(u: UnitQuantity): string {
  if (!u.range) return '-';
  const range = `${u.range.min}~${u.range.max}`;
  return u.asked === null ? range : `출제 ${u.asked} / ${range}`;
}

/** Whether an assessment asks a number of items outside its range per sitting. */
const askedOff = (u: UnitQuantity) =>
  u.asked !== null && u.range !== null && (u.asked < u.range.min || u.asked > u.range.max);

function unitRow(u: UnitQuantity, flagged: Set<string>): string[] {
  const share = (n: number) => (u.count === 0 ? '-' : `${n} (${Math.round((n / u.count) * 100)}%)`);
  return [
    u.lessonId,
    KIND_LABELS[u.kind],
    u.kind === 'lesson' ? u.importance : '-',
    String(u.count),
    criterion(u),
    ...(u.kind === 'lesson'
      ? CATEGORIES.map((c) => share(u.byCategory[c]))
      : CATEGORIES.map(() => '-')),
    u.byDifficulty.join('/'),
    String(u.byType.size),
    String(u.drafts),
    flagged.has(u.lessonId) || askedOff(u) ? '✗' : '✓',
  ];
}

const HEADER = [
  '단원',
  '종류',
  '중요도',
  '승인',
  '기준',
  ...CATEGORIES.map((c) => CATEGORY_LABELS[c]),
  '난이도 1/2/3/4/5',
  '유형 수',
  '초안',
  '기준 충족',
];

/** Terminal column width: Hangul and other wide characters take two columns. */
function width(text: string): number {
  let n = 0;
  for (const ch of text)
    n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(ch) ? 2 : 1;
  return n;
}

function table(rows: string[][], format: ReportFormat): string {
  if (format === 'markdown') {
    const line = (r: string[]) => `| ${r.join(' | ')} |`;
    return [
      line(rows[0] ?? []),
      line((rows[0] ?? []).map(() => '---')),
      ...rows.slice(1).map(line),
    ].join('\n');
  }
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((r) => width(r[i] ?? ''))));
  return rows
    .map((r) =>
      r
        .map((cell, i) => cell + ' '.repeat((widths[i] ?? 0) - width(cell)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function violationRows(violations: readonly QuantityViolation[]): string[][] {
  return [
    ['단원', '규칙', '수준', '내용'],
    ...violations.map((v) => [
      v.unit,
      v.rule,
      QUANTITY_LEVELS[v.family][v.rule] === 'error' ? '오류' : '경고',
      v.message.replace(/^\[[a-z-]+\] /, ''),
    ]),
  ];
}

/** Renders the report of a loaded content tree. */
export function renderReport(source: ContentSource, format: ReportFormat = 'text'): string {
  const report = measureQuantities(source);
  const violations = findQuantityViolations(source, report);
  const flagged = new Set(violations.map((v) => v.unit));
  const out: string[] = [];
  const heading = (s: string) =>
    out.push(format === 'markdown' ? `\n### ${s}\n` : `\n== ${s} ==\n`);
  for (const course of source.courses) {
    const units = report.units.filter((u) => u.courseId === course.meta.data.id);
    heading(`${course.meta.data.title} (${course.meta.data.id})`);
    out.push(table([HEADER, ...units.map((u) => unitRow(u, flagged))], format));
    const total = units.reduce((n, u) => n + u.count, 0);
    out.push(
      `\n단원 ${units.length}개, 승인 문제 ${total}개, 기준 미달 단원 ${units.filter((u) => flagged.has(u.lessonId) || askedOff(u)).length}개`,
    );
  }
  heading(`기준 위반 ${violations.length}건`);
  out.push(violations.length > 0 ? table(violationRows(violations), format) : '없음');
  return out.join('\n').trimStart();
}
