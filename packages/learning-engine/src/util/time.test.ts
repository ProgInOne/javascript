import { describe, expect, it } from 'vitest';
import type { DayBoundary } from './time.ts';
import { addDays, daysBetween, endOfLocalDay, localDateOf, startOfLocalDay } from './time.ts';

const SEOUL: DayBoundary = { timeZone: 'Asia/Seoul', dayStartHour: 4 };
const NEW_YORK: DayBoundary = { timeZone: 'America/New_York', dayStartHour: 4 };

describe('localDateOf', () => {
  it('counts the hours before dayStartHour as the previous day', () => {
    // 2026-03-03 03:59 KST = 2026-03-02 18:59 UTC
    expect(localDateOf(Date.UTC(2026, 2, 2, 18, 59), SEOUL)).toBe('2026-03-02');
    expect(localDateOf(Date.UTC(2026, 2, 2, 19, 0), SEOUL)).toBe('2026-03-03');
  });

  it('uses the learner time zone, not UTC', () => {
    // 2026-03-02 23:30 UTC is 08:30 next day in Seoul and 18:30 same day in New York.
    const at = Date.UTC(2026, 2, 2, 23, 30);
    expect(localDateOf(at, SEOUL)).toBe('2026-03-03');
    expect(localDateOf(at, NEW_YORK)).toBe('2026-03-02');
  });

  it('supports a midnight day start', () => {
    expect(
      localDateOf(Date.UTC(2026, 2, 2, 15, 0), { timeZone: 'Asia/Seoul', dayStartHour: 0 }),
    ).toBe('2026-03-03');
  });
});

describe('startOfLocalDay / endOfLocalDay', () => {
  it('finds dayStartHour in the zone', () => {
    expect(startOfLocalDay('2026-03-03', SEOUL)).toBe(Date.UTC(2026, 2, 2, 19, 0));
    expect(endOfLocalDay(Date.UTC(2026, 2, 2, 18, 59), SEOUL)).toBe(Date.UTC(2026, 2, 2, 19, 0));
    expect(endOfLocalDay(Date.UTC(2026, 2, 2, 19, 0), SEOUL)).toBe(Date.UTC(2026, 2, 3, 19, 0));
  });

  it('handles daylight saving transitions', () => {
    // US DST starts 2026-03-08 02:00; 04:00 EST = 09:00 UTC, 04:00 EDT = 08:00 UTC.
    expect(startOfLocalDay('2026-03-07', NEW_YORK)).toBe(Date.UTC(2026, 2, 7, 9, 0));
    expect(startOfLocalDay('2026-03-08', NEW_YORK)).toBe(Date.UTC(2026, 2, 8, 8, 0));
    // DST ends 2026-11-01 02:00.
    expect(startOfLocalDay('2026-11-01', NEW_YORK)).toBe(Date.UTC(2026, 10, 1, 9, 0));
    expect(localDateOf(Date.UTC(2026, 2, 8, 7, 59), NEW_YORK)).toBe('2026-03-07');
    expect(localDateOf(Date.UTC(2026, 2, 8, 8, 0), NEW_YORK)).toBe('2026-03-08');
  });
});

describe('calendar arithmetic', () => {
  it('adds days and counts days across months and years', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-02-27', '2026-03-06')).toBe(7);
    expect(daysBetween('2026-03-06', '2026-02-27')).toBe(-7);
  });
});
