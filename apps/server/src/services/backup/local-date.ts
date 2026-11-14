/** Learner-local calendar date `YYYY-MM-DD`, with the day starting at `dayStartHour` (default 04:00). */
export function localDate(now: Date, timeZone: string, dayStartHour: number): string {
  const shifted = new Date(now.getTime() - dayStartHour * 3_600_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/** ISO 8601 week label for a `YYYY-MM-DD` date, e.g. `2026-W46`. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
