import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent } from '../tools/content-cli/src/build.ts';
import { exerciseKit } from '../tools/content-cli/src/kit.ts';

/**
 * Builds the fixture content pack the E2E server reads (PROGINONE_CONTENT_DB), with one lesson's
 * practice exercises (one or more per renderable type except implement_function). Called from the
 * Playwright config because the web server starts before globalSetup would run.
 *
 * `overlay` (a directory under `fixtures/`) is copied over the fixture content first, for a
 * server that needs more content than the shared one without changing what the other specs see
 * (e.g. `content-mastery`: a unit assessment for module 1, tests/mastered.spec.ts).
 */
export function buildFixtureContent(out: string, overlay?: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  let dir = join(here, 'fixtures', 'content');
  if (overlay) {
    const merged = mkdtempSync(join(tmpdir(), `proginone-e2e-${overlay}-`));
    cpSync(dir, merged, { recursive: true });
    cpSync(join(here, 'fixtures', overlay), merged, { recursive: true, force: true });
    dir = merged;
  }
  // Fixture exercises are drafts (authored for tests, never human-reviewed): include them.
  const result = buildContent(dir, out, {
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
