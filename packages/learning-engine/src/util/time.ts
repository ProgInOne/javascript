import type { LocalDate } from '../types.ts';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/**
 * How the learner's "day" is cut: IANA time zone plus the hour a new day starts (default 04:00),
 * so that studying just after midnight still counts for the previous day.
 */
export interface DayBoundary {
  readonly timeZone: string;
  /** 0–23. */
  readonly dayStartHour: number;
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClock(at: number, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts['year'] ?? 1970,
    month: parts['month'] ?? 1,
    day: parts['day'] ?? 1,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function formatDate(year: number, month: number, day: number): LocalDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function parseDate(date: LocalDate): { year: number; month: number; day: number } {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return { year, month, day };
}

/** Learner-local calendar day of an instant, honouring `dayStartHour`. */
export function localDateOf(at: number, boundary: DayBoundary): LocalDate {
  const wall = wallClock(at, boundary.timeZone);
  const date = formatDate(wall.year, wall.month, wall.day);
  return wall.hour < boundary.dayStartHour ? addDays(date, -1) : date;
}

/** `date + days` on the calendar. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** Instant at which the learner-local day `date` begins (`date` at `dayStartHour`:00). */
export function startOfLocalDay(date: LocalDate, boundary: DayBoundary): number {
  const { year, month, day } = parseDate(date);
  const target = Date.UTC(year, month - 1, day, boundary.dayStartHour);
  const offsetAt = (at: number): number => {
    const wall = wallClock(at, boundary.timeZone);
    return (
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
      Math.floor(at / 1000) * 1000
    );
  };
  const first = target - offsetAt(target);
  return target - offsetAt(first);
}

/** Instant at which the learner's day containing `at` ends (start of the next day). */
export function endOfLocalDay(at: number, boundary: DayBoundary): number {
  return startOfLocalDay(addDays(localDateOf(at, boundary), 1), boundary);
}
