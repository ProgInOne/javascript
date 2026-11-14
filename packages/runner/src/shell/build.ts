import { fileURLToPath } from 'node:url';
import { build as esbuild, type Plugin } from 'esbuild';

/**
 * Builds `/sandbox/runner.html` (Node only; the server imports this).
 *
 * The shell and the harness are TypeScript modules bundled with esbuild into one self-contained
 * HTML document: the shell CSP allows inline and `blob:` scripts only, so nothing is loaded from
 * the network. The harness is minified to a single line so that inserting it into a learner
 * document does not move learner line numbers, and travels inside the shell bundle as a string.
 *
 * Bundling takes about 100 ms; the result is cached per process.
 */

export const RUNNER_PATH = '/sandbox/runner.html';

/**
 * Shell CSP (docs/design/code-execution-sandbox.md#셸의-csp). `'unsafe-inline'` is intended:
 * learner code runs as inline script. What this policy protects is the network, navigation and
 * string-to-code (`'unsafe-eval'` is absent).
 */
export const SHELL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  'worker-src blob:',
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "manifest-src 'none'",
  "object-src 'none'",
].join('; ');

/** Response headers for the shell document. */
export const SHELL_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': SHELL_CSP,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const entry = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/**
 * zod's namespace export keeps every locale (~260 KB). The shell only needs the English default,
 * which zod imports directly, so the locale index is replaced with an empty module.
 */
const dropZodLocales: Plugin = {
  name: 'drop-zod-locales',
  setup(b) {
    b.onResolve({ filter: /[\\/]locales[\\/]index\.js$/ }, (args) =>
      args.importer.includes('zod') ? { path: 'zod-locales', namespace: 'stub' } : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export {};', loader: 'js' }));
  },
};

/**
 * The shell CSP has no 'unsafe-eval'. zod would notice by probing `new Function` (and log a CSP
 * violation); its global config must say so before any schema is created, hence a banner.
 */
const ZOD_JITLESS = 'globalThis.__zod_globalConfig={jitless:true};';

async function bundle(
  file: string,
  extra: { define?: Record<string, string>; banner?: string } = {},
): Promise<string> {
  const result = await esbuild({
    entryPoints: [file],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    charset: 'ascii',
    write: false,
    define: extra.define ?? {},
    plugins: [dropZodLocales],
    banner: { js: extra.banner ?? '' },
    logLevel: 'silent',
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error(`esbuild produced no output for ${file}`);
  return out.text.trim();
}

/** Text that would end or confuse an inline <script> element. esbuild escapes `</script`. */
const UNSAFE_IN_SCRIPT = /<\/script|<!--/i;

/** Builds the harness alone (exported for tests). */
export async function buildHarness(): Promise<string> {
  const harness = await bundle(entry('../harness/main.ts'));
  if (harness.includes('\n') || harness.includes('\r')) {
    throw new Error('harness bundle must be a single line (no multi-line template literals)');
  }
  if (UNSAFE_IN_SCRIPT.test(harness)) throw new Error('harness bundle is not safe to inline');
  return harness;
}

async function build(): Promise<string> {
  const shell = await bundle(entry('./main.ts'), {
    define: { __HARNESS_SOURCE__: JSON.stringify(await buildHarness()) },
    banner: ZOD_JITLESS,
  });
  if (UNSAFE_IN_SCRIPT.test(shell)) throw new Error('shell bundle is not safe to inline');
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>ProgInOne 러너</title>' +
    '<style>html,body{margin:0;padding:0;height:100%;background:#fff}iframe{border:0;display:block}</style>' +
    `</head><body><script>${shell}</script></body></html>`
  );
}

let cached: Promise<string> | undefined;

/** The runner shell document. Built on first use and cached; a failed build is retried. */
export function runnerHtml(): Promise<string> {
  cached ??= build().catch((e: unknown) => {
    cached = undefined;
    throw e;
  });
  return cached;
}
