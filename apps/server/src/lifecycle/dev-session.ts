import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEV_SESSION_FILE = 'dev-session.json';

/**
 * Development only: Vite serves index.html, so it reads the session token from this file and
 * injects the same meta tag the production server does. Owner-only permissions.
 */
export function writeDevSession(
  dataDir: string,
  info: { token: string; port: number },
): () => void {
  const path = join(dataDir, DEV_SESSION_FILE);
  writeFileSync(path, JSON.stringify(info), { mode: 0o600 });
  return () => {
    rmSync(path, { force: true });
  };
}
