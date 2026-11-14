import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './load.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'proginone-config-'));

describe('loadConfig', () => {
  it('uses defaults and <repo>/.data in development', () => {
    const repo = tmp();
    const c = loadConfig({ env: {}, repoRoot: repo });
    expect(c).toMatchObject({
      port: 4310,
      dataDir: join(repo, '.data'),
      backupDir: join(repo, '.data', 'backups'),
      logLevel: 'info',
      openBrowser: false,
      aiProvider: 'codex',
      mode: 'development',
    });
  });

  it('applies env > config.json > defaults', () => {
    const dataDir = tmp();
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ port: 5000, logLevel: 'debug' }));
    const c = loadConfig({
      env: { PROGINONE_DATA_DIR: dataDir, PROGINONE_PORT: '6000' },
    });
    expect(c.port).toBe(6000); // env wins
    expect(c.logLevel).toBe('debug'); // file wins over default
    expect(c.dataDir).toBe(dataDir);
  });

  it('parses boolean env values', () => {
    const c = loadConfig({ env: { PROGINONE_DATA_DIR: tmp(), PROGINONE_OPEN_BROWSER: 'true' } });
    expect(c.openBrowser).toBe(true);
  });

  it('reports every invalid value', () => {
    try {
      loadConfig({
        env: { PROGINONE_DATA_DIR: tmp(), PROGINONE_PORT: 'abc', PROGINONE_LOG_LEVEL: 'loud' },
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const issues = (e as ConfigError).issues.join('\n');
      expect(issues).toContain('port');
      expect(issues).toContain('logLevel');
    }
  });

  it('rejects unknown or forbidden keys in config.json', () => {
    const dataDir = tmp();
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ dataDir: '/elsewhere' }));
    expect(() => loadConfig({ env: { PROGINONE_DATA_DIR: dataDir } })).toThrow(ConfigError);
  });

  it('reports malformed JSON', () => {
    const dataDir = tmp();
    writeFileSync(join(dataDir, 'config.json'), '{ nope');
    expect(() => loadConfig({ env: { PROGINONE_DATA_DIR: dataDir } })).toThrow(
      '설정 파일을 읽을 수 없습니다.',
    );
  });
});
