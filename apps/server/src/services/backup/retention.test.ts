import { describe, expect, it } from 'vitest';
import { selectExpired } from './retention.ts';

const item = (n: number, appVersion = '0.2.0') => ({
  id: `b${n}`,
  createdAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
  appVersion,
});

describe('selectExpired', () => {
  it('keeps the newest N', () => {
    const items = Array.from({ length: 5 }, (_, i) => item(i + 1));
    expect(selectExpired('pre-restore', items)).toEqual(['b2', 'b1']);
  });

  it('keeps one pre-migration backup from the previous app version', () => {
    const items = [item(1, '0.1.0'), ...Array.from({ length: 6 }, (_, i) => item(i + 2, '0.2.0'))];
    const expired = selectExpired('pre-migration', items);
    expect(expired).not.toContain('b1');
    expect(expired).toEqual(['b2']);
  });

  it('never expires manual backups', () => {
    expect(
      selectExpired(
        'manual',
        Array.from({ length: 50 }, (_, i) => item(i + 1)),
      ),
    ).toEqual([]);
  });
});
