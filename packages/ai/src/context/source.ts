// Learning information the context builder may read (docs/design/ai-system.md#contextbuilder와-contextsource).
// The server implements this over user.db and content.db; packages/ai never touches a database.

/**
 * What the learner has unlocked for an exercise. The service layer computes it from the hint
 * state in the database (D-010); the ContextSource implementation must enforce it again, so the
 * reference solution or expected values can never reach a prompt before they are allowed.
 */
export interface ExerciseAccess {
  /** Highest authored hint level opened (0–3). */
  hintLevel: 0 | 1 | 2 | 3;
  /** The learner pressed "정답 보기" in this context. */
  solutionViewed: boolean;
}

export interface ConceptStateContext {
  id: string;
  title: string;
  /** `not_started` … `mastered`. */
  stage: string;
  /** 0–100. */
  mastery: number;
  /** Review due date (`YYYY-MM-DD`) when there is a memory card. */
  due: string | null;
  /**
   * Set on direct prerequisites added by `includePrerequisites`: the requested concept this one
   * is a prerequisite of. Absent on requested concepts.
   */
  prerequisiteOf?: string;
}

/**
 * An active misconception observation (docs/design/ai-system.md#컨텍스트-조립-우선순위 "활성 오개념").
 * `origin: 'ai'` rows are unclassified AI proposals (`ai.<ULID>`): tutor context only.
 */
export interface MisconceptionContext {
  id: string;
  conceptId: string;
  title: string;
  description: string;
  status: 'suspected' | 'confirmed';
  origin: 'catalog' | 'ai';
  evidenceCount: number;
}

/** A stored conversation summary (long-term memory). AI-written: render as data. */
export interface SessionSummaryContext {
  id: string;
  /** Tutor thread the summary belongs to. */
  threadId: string;
  createdAt: number;
  /** `created_at` of the last message the summary covers. */
  coveredUntil: number;
  conceptIds: string[];
  shortSummary: string;
  struggles: { conceptId: string; note: string }[];
  openQuestions: string[];
  misconceptionSignals: string[];
}

export interface ExerciseContext {
  id: string;
  type: string;
  difficulty: number;
  /** Prompt text shown to the learner. */
  prompt: string;
  /** Code shown with the prompt (snippet or starter), if any. */
  code: string | null;
  /** Client-safe spec (exercise-kit `redactSpec`) as compact JSON. */
  publicSpec: string;
  conceptIds: string[];
  /** Authored hints up to `access.hintLevel`, in order. */
  openedHints: { level: number; text: string }[];
  /** Only present when `access.solutionViewed`. */
  solution: { explanation: string; answer: string } | null;
  access: ExerciseAccess;
  origin: 'authored' | 'template' | 'generated';
}

export interface AttemptContext {
  id: string;
  outcome: string;
  score: number;
  confidence: string | null;
  hintLevelMax: number;
  /** The learner's own answer, summarized (untrusted). */
  answerSummary: string;
  /** Feedback lines shown to the learner after grading (never hidden expectations). */
  feedback: string[];
  submittedAt: number;
}

export interface LessonContext {
  id: string;
  title: string;
  summary: string;
  objectives: string[];
  /** Plain text of the requested section (selection), or `null`. */
  sectionText: string | null;
  sectionId: string | null;
  concepts: { id: string; title: string; summary: string }[];
}

export interface TutorMessageContext {
  id: string;
  role: 'learner' | 'tutor' | 'system_event';
  content: string;
  createdAt: number;
}

export interface ContextSource {
  /** Requested concepts first; with `includePrerequisites`, then their direct prerequisites. */
  conceptStates(
    conceptIds: readonly string[],
    opts?: { includePrerequisites?: boolean },
  ): Promise<ConceptStateContext[]>;
  /** Active observations of these concepts (time rules applied), confirmed first. */
  misconceptions(conceptIds: readonly string[]): Promise<MisconceptionContext[]>;
  /** `null` when the exercise does not exist. */
  exercise(exerciseId: string, access: ExerciseAccess): Promise<ExerciseContext | null>;
  /** Most recent first. */
  attempts(exerciseId: string, opts: { limit: number }): Promise<AttemptContext[]>;
  lesson(lessonId: string, opts: { sectionId: string | null }): Promise<LessonContext | null>;
  /**
   * The last `limit` messages, oldest first, excluding `excludeMessageIds` (the turn being
   * answered) and, with `after`, messages created at or before it (already summarized).
   */
  threadMessages(
    threadId: string,
    opts: { limit: number; excludeMessageIds: readonly string[]; after?: number },
  ): Promise<TutorMessageContext[]>;
  /** The thread's current rolling summary. */
  threadSummary(threadId: string): Promise<SessionSummaryContext | null>;
  /**
   * Summaries of other threads for these concepts, best first (docs/design/ai-system.md
   * #개념-id-기반-검색). Without concepts, the most recent ones.
   */
  pastSummaries(
    conceptIds: readonly string[],
    opts: { limit: number; excludeThreadId: string | null },
  ): Promise<SessionSummaryContext[]>;
}
