import { defineConfig } from 'drizzle-kit';

// Generate SQL migrations with `pnpm --filter @proginone/server db:generate`.
// `drizzle-kit push` is never used (docs/design/data-model.md#마이그레이션-정책).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/user/schema.ts',
  out: './src/db/user/migrations',
});
