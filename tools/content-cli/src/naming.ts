/**
 * Product, service and language names are written in their official Latin spelling in learner
 * text (content-authoring.md "표기"): "Chrome", not "크롬". A transliteration reads like a
 * different word and does not match what the learner searches for or sees on screen.
 *
 * Only prose is checked: fenced and inline code are removed first, and answer lists
 * (`accept`) are not passed in, so a lenient answer such as "자바스크립트" stays allowed.
 */
const TRANSLITERATIONS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /크롬/u, name: 'Chrome' },
  { pattern: /사파리/u, name: 'Safari' },
  { pattern: /파이어폭스/u, name: 'Firefox' },
  // "엣지 케이스"(edge case) is a common term, not the browser.
  { pattern: /엣지(?!\s*케이스)/u, name: 'Edge' },
  { pattern: /자바스크립트/u, name: 'JavaScript' },
  { pattern: /타입스크립트/u, name: 'TypeScript' },
  { pattern: /깃허브|깃헙/u, name: 'GitHub' },
  { pattern: /(비주얼 ?스튜디오 ?코드|브이에스 ?코드|VS ?코드)/u, name: 'VS Code' },
  { pattern: /노드제이에스|노드\.?js/iu, name: 'Node.js' },
];

/** Removes fenced code blocks and inline code spans so code and identifiers are not checked. */
function prose(text: string): string {
  return text.replace(/```[\s\S]*?```/gu, ' ').replace(/`[^`\n]*`/gu, ' ');
}

/** The official names whose transliteration appears in `text` (each once, in table order). */
export function transliteratedNames(text: string): string[] {
  const body = prose(text);
  return TRANSLITERATIONS.filter((t) => t.pattern.test(body)).map((t) => t.name);
}

/** The warning text for a field, or null when the field is clean. */
export function namingWarning(field: string, text: string): string | null {
  const names = transliteratedNames(text);
  if (names.length === 0) return null;
  return `${field}: 제품·언어 이름은 공식 영문으로 씁니다(${names.join(', ')})`;
}
