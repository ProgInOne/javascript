import { defineConfig } from 'vitest/config';

const UI_TESTS = 'packages/exercise-ui/src/**/*.test.{ts,tsx}';
const WEB_TESTS = 'apps/web/src/**/*.test.{ts,tsx}';

export default defineConfig({
  test: {
    // Puts every test's temporary folders under one root and removes it after the run.
    globalSetup: ['tools/vitest-global-setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['{apps,packages,tools}/*/{src,scripts}/**/*.test.{ts,tsx}', 'tools/*.test.ts'],
          exclude: ['**/node_modules/**', UI_TESTS, WEB_TESTS],
        },
      },
      {
        // React components need a DOM; everything else stays on plain Node.
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: [UI_TESTS],
          setupFiles: ['packages/exercise-ui/src/test/jsdom-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: [WEB_TESTS],
          setupFiles: [
            'packages/exercise-ui/src/test/jsdom-setup.ts',
            'apps/web/src/test/setup.ts',
          ],
        },
      },
    ],
  },
});
