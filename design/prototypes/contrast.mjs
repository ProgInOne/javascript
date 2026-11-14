// 토큰 대비 측정 (WCAG 2.x 대비비)
// tokens.css의 기본 토큰(OKLCH)을 읽어 주요 텍스트/배경 쌍을 계산합니다.
import fs from "node:fs";

const css = fs.readFileSync(new URL("./assets/tokens.css", import.meta.url), "utf8");
const T = {};
for (const m of css.matchAll(/--([a-z]+-\d+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g)) {
  T[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
}

function oklchToLinearSrgb([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
}
const lum = (t) => {
  const [r, g, b] = oklchToLinearSrgb(T[t]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

// [용도, 전경, 배경, 기준]
const PAIRS = [
  ["라이트 · 본문", "neutral-900", "neutral-0", 7],
  ["라이트 · 본문 / 캔버스(A)", "neutral-900", "neutral-25", 7],
  ["라이트 · 본문 / 캔버스(C)", "neutral-900", "neutral-50", 7],
  ["라이트 · 보조 텍스트", "neutral-600", "neutral-0", 4.5],
  ["라이트 · 보조 텍스트 / 캔버스(C)", "neutral-600", "neutral-50", 4.5],
  ["라이트 · 보조 텍스트 / 선택 행", "neutral-600", "jade-50", 4.5],
  ["라이트 · 3차 텍스트(채택: neutral-550, 작은 글자)", "neutral-550", "neutral-0", 4.5],
  ["라이트 · 3차 텍스트 / 캔버스(C)", "neutral-550", "neutral-50", 4.5],
  ["라이트 · 3차 텍스트(문서: neutral-500, 작은 글자)", "neutral-500", "neutral-0", 4.5],
  ["라이트 · 링크·브랜드 텍스트", "jade-700", "neutral-0", 4.5],
  ["라이트 · 브랜드 텍스트 / 선택 배경", "jade-700", "jade-50", 4.5],
  ["라이트 · 기본 버튼 텍스트 (jade-600 L 0.545)", "neutral-0", "jade-600", 4.5],
  ["라이트 · 기본 버튼 hover", "neutral-0", "jade-700", 4.5],
  ["라이트 · 오답 피드백", "red-700", "red-50", 4.5],
  ["라이트 · 경고·힌트", "amber-800", "amber-50", 4.5],
  ["라이트 · AI 텍스트", "violet-700", "violet-50", 4.5],
  ["라이트 · AI 강조", "violet-600", "neutral-0", 4.5],
  ["라이트 · 정보 콜아웃", "blue-700", "blue-50", 4.5],
  ["라이트 · 입력 테두리(채택: neutral-500)", "neutral-500", "neutral-0", 3],
  ["라이트 · 입력 테두리(문서: neutral-300)", "neutral-300", "neutral-0", 3],
  ["라이트 · 포커스 링", "jade-600", "neutral-0", 3],
  ["라이트 · 진도 채움 / 트랙", "jade-600", "jade-100", 3],
  ["라이트 코드 · 키워드", "jade-700", "neutral-50", 4.5],
  ["라이트 코드 · 함수", "blue-700", "neutral-50", 4.5],
  ["라이트 코드 · 숫자", "amber-700", "neutral-50", 4.5],
  ["라이트 코드 · 문자열", "violet-700", "neutral-50", 4.5],
  ["라이트 코드 · 주석", "neutral-600", "neutral-50", 4.5],
  ["다크 · 본문", "neutral-50", "neutral-900", 7],
  ["다크 · 본문 / 캔버스", "neutral-50", "neutral-950", 7],
  ["다크 · 보조 텍스트", "neutral-300", "neutral-900", 4.5],
  ["다크 · 3차 텍스트", "neutral-400", "neutral-900", 4.5],
  ["다크 · 링크·브랜드 텍스트", "jade-400", "neutral-900", 4.5],
  ["다크 · 기본 버튼 텍스트", "neutral-950", "jade-500", 4.5],
  ["다크 · 오답 피드백", "red-300", "red-950", 4.5],
  ["다크 · 경고·힌트", "amber-300", "amber-950", 4.5],
  ["다크 · AI 텍스트", "violet-300", "violet-950", 4.5],
  ["다크 · AI 강조", "violet-400", "neutral-900", 4.5],
  ["다크 · 입력 테두리(채택: neutral-500)", "neutral-500", "neutral-900", 3],
  ["다크 · 입력 테두리(문서: neutral-600)", "neutral-600", "neutral-900", 3],
  ["다크 · 포커스 링", "jade-400", "neutral-900", 3],
  ["다크 코드 · 키워드", "jade-400", "neutral-900", 4.5],
  ["다크 코드 · 함수", "blue-300", "neutral-900", 4.5],
  ["다크 코드 · 숫자", "amber-300", "neutral-900", 4.5],
  ["다크 코드 · 문자열", "violet-300", "neutral-900", 4.5],
  ["다크 코드 · 주석", "neutral-400", "neutral-900", 4.5],
  ["B 작업대 · 코드 본문", "neutral-50", "neutral-950", 7],
  ["B 작업대 · 주석", "neutral-400", "neutral-950", 4.5],
];

const rows = PAIRS.map(([use, fg, bg, min]) => {
  const r = ratio(fg, bg);
  return { use, fg, bg, ratio: r.toFixed(2), min, ok: r >= min };
});
const md = process.argv.includes("--md");
if (md) {
  console.log("| 용도 | 전경 | 배경 | 대비 | 기준 | 결과 |\n|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.use} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio}:1 | ${r.min}:1 | ${r.ok ? "통과" : "**미달**"} |`);
} else {
  for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.ratio.padStart(5)}:1 (≥${r.min})  ${r.use}  ${r.fg} on ${r.bg}`);
}
process.exitCode = rows.some((r) => !r.ok && !r.use.includes("문서:")) ? 1 : 0;
