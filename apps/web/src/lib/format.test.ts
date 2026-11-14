import { describe, expect, it } from 'vitest';
import { formatMinutes, formatResetTime } from './format.ts';

describe('formatMinutes', () => {
  it.each([
    [0, '0분'],
    [25, '25분'],
    [60, '1시간'],
    [130, '2시간 10분'],
  ])('%i → %s', (n, s) => {
    expect(formatMinutes(n)).toBe(s);
  });
});

describe('formatResetTime', () => {
  const now = new Date(2026, 10, 15, 9, 0);
  it('shows the time today and the date otherwise', () => {
    expect(formatResetTime(new Date(2026, 10, 15, 14, 30).toISOString(), now)).toBe('14:30');
    expect(formatResetTime(new Date(2026, 10, 18, 8, 5).toISOString(), now)).toBe('11/18 08:05');
  });
  it('ignores missing or invalid values', () => {
    expect(formatResetTime(null, now)).toBeNull();
    expect(formatResetTime('soon', now)).toBeNull();
  });
});
