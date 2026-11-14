import { describe, expect, it } from 'vitest';
import { isoWeek, localDate } from './local-date.ts';

describe('localDate', () => {
  it('counts study before the day start hour as the previous day', () => {
    // 2026-11-14 03:30 in Seoul (UTC+9) = 2026-11-13 18:30Z
    expect(localDate(new Date('2026-11-13T18:30:00Z'), 'Asia/Seoul', 4)).toBe('2026-11-13');
    // 04:30 Seoul
    expect(localDate(new Date('2026-11-13T19:30:00Z'), 'Asia/Seoul', 4)).toBe('2026-11-14');
  });

  it('uses the learner time zone, not UTC', () => {
    expect(localDate(new Date('2026-11-14T02:00:00Z'), 'America/Los_Angeles', 0)).toBe(
      '2026-11-13',
    );
  });
});

describe('isoWeek', () => {
  it.each([
    ['2026-11-14', '2026-W46'],
    ['2026-01-01', '2026-W01'], // Thursday
    ['2027-01-01', '2026-W53'], // Friday belongs to the previous ISO year
    ['2024-12-30', '2025-W01'], // Monday belongs to the next ISO year
  ])('%s → %s', (date, week) => {
    expect(isoWeek(date)).toBe(week);
  });
});
