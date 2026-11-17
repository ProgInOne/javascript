#!/usr/bin/env node
// Fails when a semantic text/background (or non-text) token pair misses its contrast
// target in light, dark, or dark-workbench. Targets: docs/design/ui-ux.md "의미 토큰 매핑".
// Usage: node packages/ui/scripts/check-contrast.ts [--md]
import { readFileSync } from 'node:fs';
import { checkPairs, parseTokenSheet, type Pair } from './contrast.ts';

const BODY = 7;
const TEXT = 4.5;
const NON_TEXT = 3;

const surfaces = ['color-bg-canvas', 'color-bg-surface', 'color-bg-surface-raised'];

const PAIRS: Pair[] = [
  ...surfaces.map((bg) => ({ use: '본문', fg: 'color-text-primary', bg, min: BODY })),
  ...surfaces.map((bg) => ({ use: '제목', fg: 'color-text-heading', bg, min: BODY })),
  ...[...surfaces, 'color-bg-subtle', 'color-bg-selected', 'color-bg-muted'].map((bg) => ({
    use: '보조 텍스트',
    fg: 'color-text-secondary',
    bg,
    min: TEXT,
  })),
  ...[...surfaces, 'color-bg-subtle'].map((bg) => ({
    use: '3차 텍스트',
    fg: 'color-text-tertiary',
    bg,
    min: TEXT,
  })),
  ...surfaces.map((bg) => ({ use: '레슨 본문', fg: 'color-text-prose', bg, min: BODY })),
  ...surfaces.map((bg) => ({ use: '링크', fg: 'color-text-link', bg, min: TEXT })),
  { use: '브랜드 텍스트', fg: 'color-text-brand', bg: 'color-bg-surface', min: TEXT },
  { use: '브랜드 텍스트 / 선택 배경', fg: 'color-text-brand', bg: 'color-bg-selected', min: TEXT },
  { use: '본문 / 선택 배경', fg: 'color-text-primary', bg: 'color-bg-selected', min: TEXT },
  { use: '기본 버튼', fg: 'color-text-on-action', bg: 'color-action-primary', min: TEXT },
  {
    use: '기본 버튼 hover',
    fg: 'color-text-on-action',
    bg: 'color-action-primary-hover',
    min: TEXT,
  },
  {
    use: '기본 버튼 active',
    fg: 'color-text-on-action',
    bg: 'color-action-primary-active',
    min: TEXT,
  },
  { use: '위험 버튼', fg: 'color-text-on-danger', bg: 'color-action-danger', min: TEXT },
  {
    use: '위험 버튼 hover',
    fg: 'color-text-on-danger',
    bg: 'color-action-danger-hover',
    min: TEXT,
  },
  {
    use: '정답 피드백',
    fg: 'color-feedback-correct-fg',
    bg: 'color-feedback-correct-bg',
    min: TEXT,
  },
  {
    use: '오답 피드백',
    fg: 'color-feedback-incorrect-fg',
    bg: 'color-feedback-incorrect-bg',
    min: TEXT,
  },
  { use: '경고', fg: 'color-warning-fg', bg: 'color-warning-bg', min: TEXT },
  { use: '정보', fg: 'color-info-fg', bg: 'color-info-bg', min: TEXT },
  { use: '보조 강조(코럴)', fg: 'color-accent-fg', bg: 'color-accent-bg', min: TEXT },
  { use: '히어로 제목(큰 글자)', fg: 'color-hero-fg', bg: 'color-hero-bg', min: TEXT },
  { use: '히어로 보조', fg: 'color-hero-muted', bg: 'color-hero-bg', min: TEXT },
  { use: '단계 칩(왜 배울까)', fg: 'color-text-brand', bg: 'mastery-intro', min: TEXT },
  { use: '해설 상자 본문', fg: 'color-text-primary', bg: 'color-bg-explanation', min: TEXT },
  { use: '해설 상자 머리말', fg: 'color-text-brand', bg: 'color-bg-explanation', min: TEXT },
  { use: 'AI 텍스트', fg: 'color-ai-fg', bg: 'color-ai-bg', min: TEXT },
  { use: 'AI 강조', fg: 'color-ai-accent', bg: 'color-bg-surface', min: TEXT },
  { use: '오류 강조', fg: 'color-error-accent', bg: 'color-bg-surface', min: TEXT },
  ...surfaces.map((bg) => ({ use: '입력 테두리', fg: 'color-border-input', bg, min: NON_TEXT })),
  ...surfaces.map((bg) => ({ use: '포커스 링', fg: 'color-focus-ring', bg, min: NON_TEXT })),
  { use: '진도 채움 / 트랙', fg: 'color-progress-fill', bg: 'color-progress-track', min: NON_TEXT },
  { use: '진도 채움 / 표면', fg: 'color-progress-fill', bg: 'color-bg-surface', min: NON_TEXT },
  // Course detail rows (D-083): the lesson to do now sits on the selected background.
  { use: '단원 번호 / 선택 배경', fg: 'color-text-tertiary', bg: 'color-bg-selected', min: TEXT },
  {
    use: '진도 채움 / 선택 배경',
    fg: 'color-progress-fill',
    bg: 'color-bg-selected',
    min: NON_TEXT,
  },
  {
    use: '완료 아이콘 / 표면',
    fg: 'color-feedback-correct-fg',
    bg: 'color-bg-surface',
    min: NON_TEXT,
  },
  { use: '코드 본문', fg: 'code-fg', bg: 'code-bg', min: BODY },
  { use: '코드 줄 번호', fg: 'code-gutter-fg', bg: 'code-gutter-bg', min: TEXT },
  ...['syn-keyword', 'syn-fn', 'syn-number', 'syn-string', 'syn-comment', 'syn-punct'].map(
    (fg) => ({ use: '구문 강조', fg, bg: 'code-bg', min: TEXT }),
  ),
  { use: '구문 강조 / 활성 줄', fg: 'syn-comment', bg: 'code-line-active', min: TEXT },
  // Selected code stays readable: body text and every syntax color on the selection.
  { use: '코드 본문 / 선택', fg: 'code-fg', bg: 'code-selection', min: BODY },
  ...['syn-keyword', 'syn-fn', 'syn-number', 'syn-string', 'syn-comment', 'syn-punct'].map(
    (fg) => ({ use: '구문 강조 / 선택', fg, bg: 'code-selection', min: TEXT }),
  ),
];

const css = readFileSync(new URL('../src/tokens/tokens.css', import.meta.url), 'utf8');
const results = checkPairs(parseTokenSheet(css), PAIRS);

if (process.argv.includes('--md')) {
  console.log('| 테마 | 용도 | 전경 | 배경 | 대비 | 기준 | 결과 |\n|---|---|---|---|---|---|---|');
  for (const r of results) {
    const verdict = r.ok ? '통과' : '**미달**';
    console.log(
      `| ${r.scenario} | ${r.use} | \`--${r.fg}\` | \`--${r.bg}\` | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${verdict} |`,
    );
  }
} else {
  for (const r of results.filter((x) => !x.ok || process.argv.includes('--all'))) {
    const ratio = r.ratio.toFixed(2).padStart(5);
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} ${ratio}:1 (>= ${r.min}) [${r.scenario}] ${r.use}  --${r.fg} on --${r.bg}`,
    );
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 쌍 통과`);
process.exitCode = failed > 0 ? 1 : 0;
