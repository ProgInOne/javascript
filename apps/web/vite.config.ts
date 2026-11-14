import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const repoRoot = resolve(import.meta.dirname, '../..');
const dataDir = process.env['PROGINONE_DATA_DIR'] ?? join(repoRoot, '.data');
const apiPort = process.env['PROGINONE_PORT'] ?? '4310';

/**
 * Development only: inject the server's session token the same way the production server does
 * (docs/design/system-architecture.md#포트와-origin). Read on every request because a restarted
 * server writes a new token.
 */
function devSessionToken(): Plugin {
  return {
    name: 'proginone-dev-session-token',
    apply: 'serve',
    transformIndexHtml(html) {
      const file = join(dataDir, 'dev-session.json');
      if (!existsSync(file)) return html;
      const { token } = JSON.parse(readFileSync(file, 'utf8')) as { token: string };
      return html.replace('</head>', `<meta name="proginone-token" content="${token}"></head>`);
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    devSessionToken(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin rewrites Host to the API's so the server's Host allow-list accepts it.
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
  build: {
    target: 'es2024',
    sourcemap: true,
    // Served from localhost, so one ~500KB vendor chunk costs nothing noticeable.
    chunkSizeWarningLimit: 800,
  },
});
