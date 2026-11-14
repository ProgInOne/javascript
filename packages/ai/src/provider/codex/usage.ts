import type { AIUsage, AIUsageWindow } from '@proginone/shared';
import type { RateLimitSnapshot, RateLimitWindow } from './protocol.ts';

// `account/rateLimits/read` and `account/rateLimits/updated` → AIUsage
// (docs/design/ai-system.md#사용량-표시와-한도-처리). Only provider-reported values.

function toWindow(
  id: AIUsageWindow['id'],
  w: RateLimitWindow | null | undefined,
): AIUsageWindow | null {
  if (!w || typeof w.usedPercent !== 'number') return null;
  return {
    id,
    usedPercent: w.usedPercent,
    windowDurationMins: w.windowDurationMins ?? null,
    resetsAt: typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000).toISOString() : null,
  };
}

/**
 * Merges a (possibly sparse) snapshot into the previous usage: windows missing from a rolling
 * update keep their last value.
 */
export function mergeUsage(
  previous: AIUsage | null,
  snapshot: RateLimitSnapshot | null | undefined,
  now: number,
): AIUsage {
  const byId = new Map<AIUsageWindow['id'], AIUsageWindow>(
    (previous?.windows ?? []).map((w) => [w.id, w]),
  );
  for (const [id, w] of [
    ['primary', snapshot?.primary],
    ['secondary', snapshot?.secondary],
  ] as const) {
    const win = toWindow(id, w);
    if (win) byId.set(id, win);
  }
  const windows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const highest = windows.reduce<number | null>(
    (max, w) => (max === null || w.usedPercent > max ? w.usedPercent : max),
    null,
  );
  return { windows, highestUsedPercent: highest, updatedAt: now };
}

/** Reset time of the most used window (shown with `rate_limited`). */
export function busiestReset(usage: AIUsage | null): string | null {
  if (!usage || usage.windows.length === 0) return null;
  const busiest = [...usage.windows].sort((a, b) => b.usedPercent - a.usedPercent)[0];
  return busiest?.resetsAt ?? null;
}
