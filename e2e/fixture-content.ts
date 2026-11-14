import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from '../tools/content-cli/src/build.ts';
import { exerciseKit } from '../tools/content-cli/src/kit.ts';

/**
 * Builds the fixture content pack the E2E server reads (PROGINONE_CONTENT_DB), with one lesson's
 * practice exercises (one or more per renderable type except implement_function). Called from the
 * Playwright config because the web server starts before globalSetup would run.
 */
export function buildFixtureContent(out: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  // Fixture exercises are drafts (authored for tests, never human-reviewed): include them.
  const result = buildContent(join(here, 'fixtures', 'content'), out, {
    kit: exerciseKit,
    includeDrafts: true,
  });
  if (!result.written) {
    const lines = result.diagnostics.items
      .map((d) => `${d.level} ${d.file} ${d.message}`)
      .join('\n');
    throw new Error(`fixture content failed to build:\n${lines}`);
  }
}
