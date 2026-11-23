import { readFileSync } from 'node:fs';
import { TUTOR_CONFIG_TOML } from '@proginone/ai';
import { describe, expect, it } from 'vitest';

// The tutor's Codex config ships in @proginone/ai; the PoC that validated it lives in this repository.
describe('TUTOR_CONFIG_TOML', () => {
  it('matches the validated PoC bundle setting for setting', () => {
    const poc = readFileSync(
      new URL('../../../../poc/codex-tutor/tutor-config.example.toml', import.meta.url),
      'utf8',
    );
    const settings = (s: string) =>
      s
        .split('\n')
        .filter((l) => /^\w+ = /.test(l))
        .sort();
    expect(settings(TUTOR_CONFIG_TOML)).toEqual(settings(poc));
  });
});
