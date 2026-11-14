import type { ConceptId, ConceptMasteryState, ConceptState } from '../types.ts';

export function initialMasteryState(conceptId: ConceptId): ConceptMasteryState {
  return {
    conceptId,
    score: 0,
    stage: 'not_started',
    evidenceWeightSum: 0,
    distinctTypesCorrect: [],
    maxDifficultyCorrect: 0,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    stageChangedAt: null,
  };
}

export function initialConceptState(conceptId: ConceptId): ConceptState {
  return { mastery: initialMasteryState(conceptId), history: [], reviews: [], memory: null };
}
