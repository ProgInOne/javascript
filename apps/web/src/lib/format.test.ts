import { describe, expect, it } from 'vitest';
import { formatMinutes } from './format.ts';

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
