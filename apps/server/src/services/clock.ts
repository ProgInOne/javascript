/**
 * Current time in epoch milliseconds (UTC). Services take a clock instead of calling `Date.now`
 * so tests can travel in time (review due dates, day boundaries).
 */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();
