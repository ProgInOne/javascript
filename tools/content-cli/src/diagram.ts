import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `<Diagram>` source checks (docs/design/content-and-exercises.md#mdx-컴포넌트, D-050).
// The web app renders the Mermaid source in the browser with a locked configuration; content
// may not change that configuration or add interactions, and must parse.

/** Authoring rules that keep a diagram inside the app's locked Mermaid configuration. */
export function lintDiagramSource(source: string): string[] {
  const errors: string[] = [];
  if (source.trim() === '') return ['Mermaid 소스가 비어 있습니다'];
  if (source.trim().split('\n')[0]?.trim() === '---')
    errors.push('front matter(---) 설정은 쓸 수 없습니다. 테마와 보안 설정은 앱이 정합니다');
  if (/%%\s*\{/.test(source))
    errors.push('%%{init}%% 같은 지시문은 쓸 수 없습니다. 테마와 보안 설정은 앱이 정합니다');
  if (/^\s*(click|link|callback)\s/im.test(source))
    errors.push('click·link 상호작용은 쓸 수 없습니다(다이어그램은 그림으로만 보여 줍니다)');
  return errors;
}

export interface DiagramParseResult {
  /** `null` when the source parses; otherwise the first line of Mermaid's error. */
  error: string | null;
}

const WORKER = fileURLToPath(new URL('./diagram-worker.ts', import.meta.url));

/**
 * Parses Mermaid sources with Mermaid's own parser in a child process (Mermaid's API is async and
 * needs a DOM for its sanitizer; the child keeps jsdom's globals out of this process and keeps
 * `check` synchronous). Returns one result per source, in order.
 */
export function parseDiagrams(sources: readonly string[]): DiagramParseResult[] {
  if (sources.length === 0) return [];
  const child = spawnSync(process.execPath, [WORKER], {
    input: JSON.stringify(sources),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    const reason = child.error?.message ?? child.stderr.trim().split('\n').slice(-3).join(' ');
    throw new Error(`Mermaid 구문 검사를 실행하지 못했습니다: ${reason}`);
  }
  const results = JSON.parse(child.stdout) as unknown;
  if (!Array.isArray(results) || results.length !== sources.length)
    throw new Error('Mermaid 구문 검사 결과 형식이 올바르지 않습니다');
  return results.map((r) => ({
    error: typeof r === 'string' ? r : null,
  }));
}
