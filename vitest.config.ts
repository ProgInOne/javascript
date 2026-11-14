import { defineConfig } from 'vitest/config';

const UI_TESTS = 'packages/ui/src/**/*.test.{ts,tsx}';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['{apps,packages,tools}/*/{src,scripts}/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', UI_TESTS],
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
    ],
  },
});
