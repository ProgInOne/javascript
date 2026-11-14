/** Languages the code editor supports (P0: one `index.html`, `.js`, `.css`). */
export type EditorLanguage = 'js' | 'html' | 'css';

/** Editor language for a file path, or `null` for unsupported files. */
export function languageOfPath(path: string): EditorLanguage | null {
  if (/\.m?js$/i.test(path)) return 'js';
  if (/\.html?$/i.test(path)) return 'html';
  if (/\.css$/i.test(path)) return 'css';
  return null;
}

/** Formatting failed because the code does not parse. `line` is 1-based when known. */
export class FormatError extends Error {
  readonly line: number | undefined;
  constructor(line: number | undefined) {
    super(
      line === undefined
        ? '코드를 읽을 수 없어 정리하지 못했어요(문법 오류). 코드를 확인해 보세요.'
        : `코드를 읽을 수 없어 정리하지 못했어요(문법 오류). ${line}번째 줄 근처를 확인해 보세요.`,
    );
    this.name = 'FormatError';
    this.line = line;
  }
}

/** Learner-facing Prettier options: the repo style, narrower for the editor pane. */
const OPTIONS = { singleQuote: true, printWidth: 80, trailingComma: 'all' } as const;

const PARSERS: Readonly<Record<EditorLanguage, string>> = {
  js: 'babel',
  html: 'html',
  css: 'css',
};

/**
 * Formats code with Prettier (the "포맷" command, `⇧⌥F`). Prettier and its plugins load on first
 * use so they stay out of the initial bundle. Throws {@link FormatError} for unparsable code.
 */
export async function formatCode(code: string, language: EditorLanguage): Promise<string> {
  const [prettier, babel, estree, html, postcss] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
  ]);
  try {
    return await prettier.format(code, {
      ...OPTIONS,
      parser: PARSERS[language],
      // HTML needs the JS and CSS plugins for inline <script> and <style>.
      plugins: [babel, estree, html, postcss],
    });
  } catch (error) {
    throw new FormatError(syntaxErrorLine(error));
  }
}

function syntaxErrorLine(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('loc' in error)) return undefined;
  const loc = (error as { loc?: { start?: { line?: unknown } } }).loc;
  const line = loc?.start?.line;
  return typeof line === 'number' ? line : undefined;
}
