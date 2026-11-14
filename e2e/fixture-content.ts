import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from '../tools/content-cli/src/build.ts';

/**
 * Builds the fixture content pack the E2E server reads (PROGINONE_CONTENT_DB). Called from the
 * Playwright config because the web server starts before globalSetup would run.
 */
export function buildFixtureContent(out: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  const unused = () => {
    throw new Error('fixture content has no exercises');
  };
  const result = buildContent(join(here, 'fixtures', 'content'), out, {
    kit: { validateSpec: () => ({ ok: true }), redact: unused, leakFingerprints: unused },
  });
  if (!result.written) {
    const lines = result.diagnostics.items
      .map((d) => `${d.level} ${d.file} ${d.message}`)
      .join('\n');
    throw new Error(`fixture content failed to build:\n${lines}`);
  }
}
