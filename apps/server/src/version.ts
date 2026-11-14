import { readFileSync } from 'node:fs';

/** App version from the root package.json (SemVer, D-017). */
export const APP_VERSION: string = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
