import { defineConfig } from 'vitest/config';

const UI_TESTS = 'packages/{ui,exercise-ui}/src/**/*.test.{ts,tsx}';
const WEB_TESTS = 'apps/web/src/**/*.test.{ts,tsx}';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['{apps,packages,tools}/*/{src,scripts}/**/*.test.{ts,tsx}'],
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
          setupFiles: ['packages/ui/src/test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: [WEB_TESTS],
          setupFiles: ['packages/ui/src/test/setup.ts', 'apps/web/src/test/setup.ts'],
        },
      },
    ],
  },
});
