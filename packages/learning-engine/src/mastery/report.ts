import type { EngineDeps } from '../config.ts';
import type { ConceptState } from '../types.ts';
import type { DayBoundary } from '../util/time.ts';
import type { EffectiveMastery } from './effective.ts';
import { effectiveMastery } from './effective.ts';
import type { GateResult } from './stage.ts';
import { evaluateGates, nextGateStage } from './stage.ts';

export interface ConceptReport extends EffectiveMastery {
  /** The stage the learner works towards and its unmet conditions; null at `mastered`. */
  readonly nextStage:
    ({ readonly stage: 'practicing' | 'proficient' | 'mastered' } & GateResult) | null;
}

/**
 * A concept's state as of `now` for display (concept detail, "숙련까지: …"): effective mastery
 * with forgetting and the gates of the next stage. Read-only; nothing is stored.
 */
export function conceptReport(
  deps: EngineDeps,
  state: ConceptState,
  now: number,
  dayBoundary: DayBoundary,
): ConceptReport {
  const eff = effectiveMastery(deps, state.mastery.score, state.memory, now);
  const next = nextGateStage(state.mastery.stage);
  if (next === null) return { ...eff, nextStage: null };
  const gates = evaluateGates(deps.config, {
    effective: eff.effective,
    evidenceWeightSum: state.mastery.evidenceWeightSum,
    history: state.history,
    reviews: state.reviews,
    dayBoundary,
  });
  return { ...eff, nextStage: { stage: next, ...gates[next] } };
}
