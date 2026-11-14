/**
 * A simulated learner for multi-day tests. It follows today's plan every study day the way the
 * server and the web app do (review set → continue/new lesson → weakness practice), answering
 * with a seeded probability model, and folds every engine output back into its state like the
 * server persists it. Used by the 30-day simulation (roadmap M5 completion criterion).
 */
import type { EngineDeps } from '../config.ts';
import type { AttemptEffects } from '../mastery/apply.ts';
import { applyAttempt, applyLessonRead, initialConceptState } from '../mastery/apply.ts';
import { effectiveMastery } from '../mastery/effective.ts';
import type { ReviewLogRecord } from '../memory/flush.ts';
import { conceptsReadyToFlush, flushPendingRatings } from '../memory/flush.ts';
import type { PendingRating } from '../memory/rating.ts';
import type { ReviewQueueEntry } from '../memory/review-queue.ts';
import { buildReviewQueue } from '../memory/review-queue.ts';
import type { MisconceptionState } from '../misconception/transitions.ts';
import type { DailyPlan } from '../planning/daily-plan.ts';
import { buildDailyPlan, dailyReviewMinutes } from '../planning/daily-plan.ts';
import type { Goal, LessonEstimate, PaceResult } from '../planning/pace.ts';
import { computePace } from '../planning/pace.ts';
import type { ExerciseCandidate, PlannedItem } from '../practice/candidates.ts';
import { buildLessonPracticeSet } from '../practice/lesson-set.ts';
import type { PassRuleItem } from '../practice/pass-rule.ts';
import { evaluatePassRule } from '../practice/pass-rule.ts';
import { buildReviewSet } from '../practice/review-set.ts';
import {
  buildWeaknessSet,
  rankWeakConcepts,
  selectWeaknessTargets,
} from '../practice/weakness-set.ts';
import type {
  AttemptFacts,
  ConceptState,
  ExerciseCategory,
  Importance,
  LocalDate,
  PracticeSetKind,
} from '../types.ts';
import type { Rng } from '../util/rng.ts';
import { createRng } from '../util/rng.ts';
import type { DayBoundary } from '../util/time.ts';
import { localDateOf } from '../util/time.ts';

export interface SimConcept {
  readonly id: string;
  readonly importance: Importance;
  readonly moduleId: string;
  /** Probability of a correct L2 answer before any practice. */
  readonly base: number;
  /** Wrong answers point to the concept's misconception. */
  readonly misconceptionProne: boolean;
}

export interface SimLesson {
  readonly id: string;
  readonly importance: Importance;
  readonly introduces: readonly string[];
  readonly estimatedMinutes: number;
  readonly readMinutes: number;
}

export interface DayLog {
  readonly day: number;
  readonly date: LocalDate;
  readonly studied: boolean;
  readonly plan: DailyPlan | null;
  readonly pace: PaceResult | null;
  /** Due reviews at the start of the day (all of them, priority order). */
  readonly dueAtStart: readonly ReviewQueueEntry[];
  readonly reviewedConcepts: readonly string[];
  readonly lessonsCompleted: readonly string[];
  readonly weaknessConcepts: readonly string[];
  readonly activeMinutes: number;
}

const TYPES: readonly { type: string; category: ExerciseCategory }[] = [
  { type: 'mcq_single', category: 'recognition' },
  { type: 'predict_output', category: 'recall' },
  { type: 'fill_blank', category: 'recall' },
  { type: 'fix_bug', category: 'production' },
];

/** Exercises per concept: every type at every difficulty, twice (distinct variant groups). */
export function exercisesFor(concepts: readonly SimConcept[]): ExerciseCandidate[] {
  const out: ExerciseCandidate[] = [];
  for (const c of concepts) {
    for (let d = 1; d <= 5; d++) {
      for (const [t, { type, category }] of TYPES.entries()) {
        for (let n = 0; n < 2; n++) {
          const id = `${c.id}.L${d}.${type}.${n}`;
          out.push({
            id,
            type,
            category,
            difficulty: d as ExerciseCandidate['difficulty'],
            estimatedSeconds: 60 + 30 * t,
            variantGroupKey: id,
            concepts: [{ conceptId: c.id, weight: 1, isPrimary: true }],
            origin: 'authored',
          });
        }
      }
    }
  }
  return out;
}

const misconceptionOf = (conceptId: string) => `${conceptId}.mc`;

export class SimulatedLearner {
  readonly states = new Map<string, ConceptState>();
  readonly misconceptions = new Map<string, MisconceptionState>();
  readonly reviewLogs: ReviewLogRecord[] = [];
  readonly days: DayLog[] = [];
  readonly lessonProgress = new Map<string, LessonEstimate['status']>();
  /** First time each concept was practised (for the mastered timing check). */
  readonly firstPracticeAt = new Map<string, number>();
  readonly lastSeenAtByGroup: Record<string, number> = {};
  readonly #practice = new Map<string, number>();
  readonly #rng: Rng;
  readonly #byId: Map<string, SimConcept>;
  readonly #exercises: ExerciseCandidate[];
  #now = 0;
  #seq = 0;

  readonly deps: EngineDeps;
  readonly input: {
    readonly concepts: readonly SimConcept[];
    readonly lessons: readonly SimLesson[];
    readonly goal: Goal;
    readonly dayBoundary: DayBoundary;
    readonly seed: string;
  };

  constructor(deps: EngineDeps, input: SimulatedLearner['input']) {
    this.deps = deps;
    this.input = input;
    this.#rng = createRng(input.seed);
    this.#byId = new Map(input.concepts.map((c) => [c.id, c]));
    this.#exercises = exercisesFor(input.concepts);
  }

  state(id: string): ConceptState {
    return this.states.get(id) ?? initialConceptState(id);
  }

  /** Runs one day: study at `start` (learner-local evening) unless it is a rest day. */
  runDay(day: number, start: number, rest: boolean): DayLog {
    const { deps } = this;
    const { dayBoundary, goal } = this.input;
    this.#now = start;
    const date = localDateOf(start, dayBoundary);
    const all = this.#reviewQueue(date);
    const pace = this.#pace(date);
    if (rest) {
      const log = this.#log(day, date, false, null, pace, all, [], [], [], 0);
      this.days.push(log);
      return log;
    }
    const weak = this.#weak();
    const plan = buildDailyPlan(deps, {
      goal,
      todayActiveMs: 0,
      reviewQueue: all,
      // A lesson whose last set ended without passing is not "in progress": the plan moves on to
      // the next lesson and weakness practice (no lesson is ever locked, D-033). Sets run to the
      // end within a block here, so only a lesson being read could be continued.
      continueLesson: this.#lessonEstimate((s) => s === 'reading'),
      nextLesson: this.#lessonEstimate((s) => s === 'not_started'),
      weakConcepts: weak,
      pace,
      firstRun: this.states.size === 0,
    });
    const reviewed: string[] = [];
    const completed: string[] = [];
    const weaknessDone: string[] = [];
    for (const block of plan.blocks) {
      if (block.kind === 'review') {
        const entries = all.filter((e) => block.conceptIds.includes(e.conceptId));
        reviewed.push(...this.#reviewSet(entries));
      } else if (block.kind === 'continue' || block.kind === 'new_lesson') {
        const lesson = this.input.lessons.find((l) => l.id === block.lessonId);
        if (lesson && this.#lesson(lesson)) completed.push(lesson.id);
      } else {
        const targets = selectWeaknessTargets(deps, weak).filter((e) =>
          block.conceptIds.includes(e.conceptId),
        );
        weaknessDone.push(...targets.map((t) => t.conceptId));
        this.#runSet('weakness', this.#weaknessItems(targets));
      }
    }
    const log = this.#log(
      day,
      date,
      true,
      plan,
      pace,
      all,
      reviewed,
      completed,
      weaknessDone,
      Math.round((this.#now - start) / 60_000),
    );
    this.days.push(log);
    return log;
  }

  #log(
    ...args: [
      number,
      LocalDate,
      boolean,
      DailyPlan | null,
      PaceResult | null,
      ReviewQueueEntry[],
      string[],
      string[],
      string[],
      number,
    ]
  ): DayLog {
    const [
      day,
      date,
      studied,
      plan,
      pace,
      dueAtStart,
      reviewedConcepts,
      lessonsCompleted,
      weaknessConcepts,
      activeMinutes,
    ] = args;
    return {
      day,
      date,
      studied,
      plan,
      pace,
      dueAtStart,
      reviewedConcepts,
      lessonsCompleted,
      weaknessConcepts,
      activeMinutes,
    };
  }

  #reviewQueue(today: LocalDate): ReviewQueueEntry[] {
    const concepts = [...this.states.values()].flatMap((s) => {
      if (s.memory === null) return [];
      const last = s.memory.card.lastReviewAt;
      // D-029: concepts already rated today wait for tomorrow.
      if (last !== null && localDateOf(last, this.input.dayBoundary) === today) return [];
      const lastLog = this.reviewLogs.filter((l) => l.conceptId === s.mastery.conceptId).at(-1);
      return [
        {
          memory: s.memory,
          mastery: s.mastery,
          importance: this.#byId.get(s.mastery.conceptId)?.importance ?? 'standard',
          lastRating: lastLog?.rating ?? null,
          activeMisconceptions: [...this.misconceptions.values()].filter(
            (m) =>
              m.conceptId === s.mastery.conceptId &&
              (m.status === 'suspected' || m.status === 'confirmed'),
          ).length,
        },
      ];
    });
    const full = buildReviewQueue(this.deps, {
      concepts,
      budgetMinutes: 24 * 60,
      now: this.#now,
      dayBoundary: this.input.dayBoundary,
    });
    return [...full.due, ...full.deferred];
  }

  /** The review queue the server would show today (budget = the goal's review share). */
  reviewQueueBudgetMinutes(entries: readonly ReviewQueueEntry[]): number {
    return dailyReviewMinutes(this.deps, this.input.goal, entries);
  }

  #pace(today: LocalDate): PaceResult | null {
    return computePace(this.deps, {
      goal: this.input.goal,
      lessons: this.input.lessons.map((l) => this.#estimate(l)),
      completedTimings: [],
      today,
      todayGoalMet: false,
    });
  }

  #estimate(lesson: SimLesson): LessonEstimate {
    const status = this.lessonProgress.get(lesson.id) ?? 'not_started';
    return {
      lessonId: lesson.id,
      estimatedMinutes: lesson.estimatedMinutes,
      readMinutes: lesson.readMinutes,
      status,
      readProgress: status === 'not_started' ? 0 : 1,
      practiceProgress: 0,
    };
  }

  #lessonEstimate(pick: (s: LessonEstimate['status']) => boolean): LessonEstimate | null {
    const lesson = this.input.lessons.find((l) =>
      pick(this.lessonProgress.get(l.id) ?? 'not_started'),
    );
    return lesson ? this.#estimate(lesson) : null;
  }

  #weak() {
    return rankWeakConcepts(this.deps, {
      concepts: [...this.states.values()].map((state) => {
        const active = [...this.misconceptions.values()].filter(
          (m) => m.conceptId === state.mastery.conceptId,
        );
        return {
          state,
          importance: this.#byId.get(state.mastery.conceptId)?.importance ?? 'standard',
          confirmedMisconceptions: active.filter((m) => m.status === 'confirmed').length,
          suspectedMisconceptions: active.filter((m) => m.status === 'suspected').length,
        };
      }),
      now: this.#now,
    });
  }

  #seed(kind: string): string {
    this.#seq += 1;
    return `${this.input.seed}:${kind}:${this.#seq}`;
  }

  #activeTargets(): string[] {
    const out: string[] = [];
    for (const m of this.misconceptions.values()) {
      if (m.status !== 'suspected' && m.status !== 'confirmed') continue;
      out.push(
        ...this.#exercises
          .filter((e) => e.concepts[0]?.conceptId === m.conceptId && e.category !== 'production')
          .map((e) => e.id),
      );
    }
    return out;
  }

  #reviewSet(entries: readonly ReviewQueueEntry[]): string[] {
    if (entries.length === 0) return [];
    const ids = entries.map((e) => e.conceptId);
    const set = buildReviewSet(this.deps, {
      entries,
      concepts: ids.map((id) => ({
        conceptId: id,
        moduleId: this.#byId.get(id)?.moduleId ?? 'm',
        state: this.state(id),
      })),
      candidates: this.#exercises.filter((e) => ids.includes(e.concepts[0]?.conceptId ?? '')),
      lastSeenAtByGroup: this.lastSeenAtByGroup,
      misconceptionTargetIds: this.#activeTargets(),
      seed: this.#seed('review'),
      now: this.#now,
    });
    return this.#runSet('review', set.items).reviewed;
  }

  /** Reads (if new) and practises a lesson; true when its pass rule passes. */
  #lesson(lesson: SimLesson): boolean {
    const status = this.lessonProgress.get(lesson.id) ?? 'not_started';
    if (status === 'not_started') {
      const read = applyLessonRead(this.deps, {
        concepts: lesson.introduces.map((id) => this.state(id)),
        now: this.#now,
      });
      for (const update of read.mastery) {
        this.states.set(update.conceptId, {
          ...this.state(update.conceptId),
          mastery: update.after,
        });
      }
      this.#now += lesson.readMinutes * 60_000;
      this.lessonProgress.set(lesson.id, 'reading');
    }
    const plan = buildLessonPracticeSet(this.deps, {
      lesson: {
        id: lesson.id,
        importance: lesson.importance,
        introduces: lesson.introduces,
        reviews: [],
      },
      concepts: lesson.introduces.map((id) => ({
        conceptId: id,
        importance: this.#byId.get(id)?.importance ?? 'standard',
        state: this.state(id),
      })),
      candidates: this.#exercises.filter((e) =>
        lesson.introduces.includes(e.concepts[0]?.conceptId ?? ''),
      ),
      lastSeenAtByGroup: this.lastSeenAtByGroup,
      misconceptionTargetIds: this.#activeTargets(),
      seed: this.#seed('lesson'),
      now: this.#now,
    });
    const result = this.#runSet('lesson', plan.items);
    const pass = evaluatePassRule(this.deps.config, plan.passRule, {
      items: result.passItems,
      introducedScores: Object.fromEntries(
        lesson.introduces.map((id) => [id, this.state(id).mastery.score]),
      ),
    });
    this.lessonProgress.set(lesson.id, pass.passed ? 'completed' : 'practicing');
    return pass.passed;
  }

  #weaknessItems(targets: ReturnType<typeof selectWeaknessTargets>): readonly PlannedItem[] {
    if (targets.length === 0) return [];
    const ids = targets.map((t) => t.conceptId);
    const confirmedTargetIds = Object.fromEntries(
      ids.map((id) => [
        id,
        this.misconceptions.get(misconceptionOf(id))?.status === 'confirmed'
          ? this.#exercises
              .filter((e) => e.concepts[0]?.conceptId === id && e.category !== 'production')
              .map((e) => e.id)
          : [],
      ]),
    );
    return buildWeaknessSet(this.deps, {
      targets,
      concepts: ids.map((id) => this.state(id)),
      candidates: this.#exercises.filter((e) => ids.includes(e.concepts[0]?.conceptId ?? '')),
      confirmedTargetIds,
      lastSeenAtByGroup: this.lastSeenAtByGroup,
      misconceptionTargetIds: this.#activeTargets(),
      seed: this.#seed('weakness'),
      now: this.#now,
    }).items;
  }

  /** Answers the items in order, flushing each concept's ratings once its items are done. */
  #runSet(kind: PracticeSetKind, items: readonly PlannedItem[]) {
    const pending: PendingRating[] = [];
    const flushed = new Set<string>();
    const reviewed: string[] = [];
    const passItems: PassRuleItem[] = [];
    for (const [index, item] of items.entries()) {
      const exercise = this.#exercises.find((e) => e.id === item.exerciseId);
      if (!exercise) continue;
      this.#now += item.estimatedSeconds * 1000;
      const { facts, effects } = this.#answer(exercise, kind);
      pending.push(...effects.pendingRatings);
      passItems.push({
        status: 'answered',
        type: exercise.type,
        difficulty: exercise.difficulty,
        finalAttempt: {
          o: facts.outcome === 'correct' ? 1 : 0,
          hintLevelMax: 0,
          solutionViewed: false,
          tutorAssisted: false,
          attemptInItem: 1,
        },
        firstAttemptCorrect: facts.outcome === 'correct',
      });
      const remaining = items.slice(index + 1).map((i) => i.targetConceptId);
      const ready = conceptsReadyToFlush({
        pending: pending.filter((p) => !flushed.has(p.conceptId)),
        remainingItemConcepts: remaining,
        setFinished: index === items.length - 1,
      });
      if (ready.length === 0) continue;
      const result = flushPendingRatings(this.deps, {
        pending: pending.filter((p) => ready.includes(p.conceptId)),
        concepts: ready.map((id) => this.state(id)),
        now: this.#now,
        dayBoundary: this.input.dayBoundary,
      });
      for (const id of ready) flushed.add(id);
      for (const m of result.memory)
        this.states.set(m.conceptId, { ...this.state(m.conceptId), memory: m });
      for (const log of result.reviewLogs) {
        this.reviewLogs.push(log);
        reviewed.push(log.conceptId);
        const s = this.state(log.conceptId);
        this.states.set(log.conceptId, {
          ...s,
          reviews: [
            ...s.reviews,
            {
              reviewedAt: log.reviewedAt,
              rating: log.rating,
              variantGroupKeys: log.sourceVariantGroupKeys,
            },
          ],
        });
      }
      for (const u of result.mastery)
        this.states.set(u.conceptId, { ...this.state(u.conceptId), mastery: u.after });
    }
    return { reviewed, passItems };
  }

  /** The learner's answer: correct with a probability from ability, practice and recall. */
  #answer(
    exercise: ExerciseCandidate,
    kind: PracticeSetKind,
  ): { facts: AttemptFacts; effects: AttemptEffects } {
    const conceptId = exercise.concepts[0]?.conceptId ?? '';
    const concept = this.#byId.get(conceptId);
    const state = this.state(conceptId);
    const practice = this.#practice.get(conceptId) ?? 0;
    const r =
      (state.memory?.card.lastReviewAt ?? null) === null || state.memory === null
        ? 1
        : this.deps.fsrs.retrievability(state.memory.card, this.#now);
    const p = Math.min(
      0.97,
      Math.max(
        0.05,
        (concept?.base ?? 0.5) +
          0.03 * Math.min(practice, 10) -
          0.1 * (exercise.difficulty - 2) -
          0.3 * (1 - r),
      ),
    );
    const correct = this.#rng() < p;
    this.#practice.set(conceptId, practice + 1);
    if (!this.firstPracticeAt.has(conceptId)) this.firstPracticeAt.set(conceptId, this.#now);
    this.lastSeenAtByGroup[exercise.variantGroupKey] = this.#now;
    this.#seq += 1;
    const facts: AttemptFacts = {
      attemptId: `a${this.#seq}`,
      outcome: correct ? 'correct' : 'incorrect',
      score: correct ? 1 : 0,
      confidence: correct ? (p > 0.7 ? 'sure' : 'unsure') : 'unsure',
      hintLevelMax: 0,
      solutionViewed: false,
      tutorAssisted: false,
      attemptInItem: 1,
      activeMs: exercise.estimatedSeconds * 1000,
      setKind: kind,
      submittedAt: this.#now,
    };
    const mc = misconceptionOf(conceptId);
    const targeted = exercise.category !== 'production';
    const effects = applyAttempt(this.deps, {
      attempt: facts,
      exercise,
      concepts: [state],
      now: this.#now,
      dayBoundary: this.input.dayBoundary,
      misconceptions: {
        observed:
          !correct && concept?.misconceptionProne === true && targeted
            ? [
                {
                  misconceptionId: mc,
                  conceptId,
                  source: exercise.category === 'recognition' ? 'distractor' : 'pattern',
                },
              ]
            : [],
        targets: targeted ? [mc] : [],
        states: [...this.misconceptions.values()].filter((m) => m.misconceptionId === mc),
      },
    });
    for (const update of effects.mastery) {
      const prev = this.state(update.conceptId);
      const facts$ = effects.evidence.flatMap((e) =>
        e.conceptId === update.conceptId && e.kind === 'attempt' && 'fact' in e.breakdown
          ? [e.breakdown.fact]
          : [],
      );
      this.states.set(update.conceptId, {
        ...prev,
        mastery: update.after,
        history: [...prev.history, ...facts$],
      });
    }
    for (const u of effects.misconceptions) this.misconceptions.set(u.misconceptionId, u.after);
    return { facts, effects };
  }

  effective(conceptId: string): number {
    const s = this.state(conceptId);
    return effectiveMastery(this.deps, s.mastery.score, s.memory, this.#now).effective;
  }
}
