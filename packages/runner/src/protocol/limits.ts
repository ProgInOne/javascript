import type { RUN_PURPOSES } from '@proginone/run-contract';
import { z } from 'zod';

/** Resource limits of one run (docs/design/code-execution-sandbox.md#스키마-스케치). */
export const limitsSchema = z.object({
  /** Whole run, checks included. The shell terminates the run shortly after this. */
  maxDurationMs: z.number().int().min(100).max(10_000),
  /** Quiet period after the last timer callback or console output before the run counts as settled. */
  quietMs: z.number().int().min(0).max(1_000),
  /** How long one loop may spin before the loop guard stops it. */
  loopBudgetMs: z.number().int().min(50).max(5_000),
  maxConsoleEntries: z.number().int().min(1).max(5_000),
  /** Serialized size of one console entry. Longer strings are cut at 8,000 characters first. */
  maxEntryBytes: z.number().int().min(1_000).max(100_000),
  /** Serialized size of one observation (one check step). */
  maxObservationBytes: z.number().int().min(1_000).max(256_000),
  /** One check step, e.g. one `callFunction`. */
  checkTimeoutMs: z.number().int().min(100).max(10_000),
  /** Console plus observations of the whole run. */
  maxOutputBytes: z.number().int().min(10_000).max(5_000_000),
});

export type Limits = z.infer<typeof limitsSchema>;

type RunPurpose = (typeof RUN_PURPOSES)[number];

const BASE: Limits = {
  maxDurationMs: 3_000,
  quietMs: 50,
  loopBudgetMs: 1_000,
  maxConsoleEntries: 1_000,
  maxEntryBytes: 10_000,
  maxObservationBytes: 64_000,
  checkTimeoutMs: 3_000,
  maxOutputBytes: 1_000_000,
};

/**
 * Default limits per purpose. Grading and verification get 10 seconds for the whole run because
 * all checks of one exercise share it (same values as content-and-exercises.md#채점-위치와-정답-키-비노출).
 */
export function defaultLimits(purpose: RunPurpose): Limits {
  return purpose === 'interactive' ? { ...BASE } : { ...BASE, maxDurationMs: 10_000 };
}

/**
 * Merges overrides into the purpose defaults and validates the result.
 * @throws ZodError when an override is out of range.
 */
export function resolveLimits(
  purpose: RunPurpose,
  overrides: { [K in keyof Limits]?: Limits[K] | undefined } = {},
): Limits {
  const merged: Record<string, number> = { ...defaultLimits(purpose) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value;
  }
  return limitsSchema.parse(merged);
}
