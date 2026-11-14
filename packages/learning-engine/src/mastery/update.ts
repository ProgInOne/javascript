import type { EngineConfig } from '../config.ts';
import { clamp } from '../util/math.ts';

/**
 * Weighted EWMA update: `step = min(α × w, STEP_MAX)`, `score' = score + step × (100·o − score)`.
 */
export function updateScore(
  config: EngineConfig,
  score: number,
  o: number,
  weight: number,
): { step: number; score: number } {
  const step = Math.min(config.mastery.alpha * Math.max(weight, 0), config.mastery.stepMax);
  const target = 100 * clamp(o, 0, 1);
  return { step, score: clamp(score + step * (target - score), 0, 100) };
}
