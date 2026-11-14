import type {
  AttemptContext,
  ConceptStateContext,
  ContextSource,
  ExerciseAccess,
  ExerciseContext,
  LessonContext,
  MisconceptionContext,
  SessionSummaryContext,
  TutorMessageContext,
} from '@proginone/ai';
import { exerciseOriginOf, redactSpec } from '@proginone/exercise-kit';
import {
  defaultEngineConfig,
  isAiMisconception,
  misconceptionStatusAt,
} from '@proginone/learning-engine';
import { HINT_LEVELS, sessionSummaryContentSchema, type SolutionView } from '@proginone/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { UserDb } from '../db/user/connection.ts';
import { hintState, listHintEvents } from '../db/user/exercise-records.ts';
import { gradingJson } from '../db/user/json.ts';
import { attempts, conceptMastery, conceptMemory, submissions } from '../db/user/schema.ts';
import { listObservationsForConcepts } from '../db/user/misconceptions.ts';
import { pastSummaries, threadSummary, type SummaryRow } from '../db/user/summaries.ts';
import { recentMessages } from '../db/user/tutor.ts';
import { localDate } from '../services/backup/local-date.ts';
import type { ContentAccess } from '../services/curriculum/content-access.ts';
import { kit, loadSpec } from '../services/practice/kit.ts';
import { solutionView } from '../services/practice/solution-view.ts';

// ContextSource over user.db and content.db (docs/design/ai-system.md#contextbuilder와-contextsource).
// Request-scoped: it knows the learner and the practice item, and it re-derives what the learner
// unlocked from the hint records (D-010). A caller asking for more than the records allow gets
// the recorded level, so the reference answer can never reach a prompt early.

export interface TutorContextScope {
  learnerId: string;
  timezone: string;
  dayStartHour: number;
  /** Hint scope: the practice set item, or `null` for the exercise outside any set. */
  practiceSetItemId: string | null;
  /** Clock of the learning services (misconception time rules). Default: system time. */
  now?: () => number;
}

/** A stored summary as context (AI-written content: the prompt renders it as data). */
export function summaryContext(row: SummaryRow): SessionSummaryContext | null {
  const parsed = sessionSummaryContentSchema.safeParse(row.summaryJson);
  if (!parsed.success) return null;
  const s = parsed.data;
  return {
    id: row.id,
    threadId: row.scopeId,
    createdAt: row.createdAt.getTime(),
    coveredUntil: row.coveredUntil.getTime(),
    conceptIds: s.conceptIds,
    shortSummary: s.shortSummary,
    struggles: s.struggles.map((x) => ({ conceptId: x.conceptId, note: x.note })),
    openQuestions: s.openQuestions,
    misconceptionSignals: s.misconceptionSignals.map((m) => m.description),
  };
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Plain text of a "정답 보기" view for the prompt. */
export function solutionText(view: SolutionView): string {
  switch (view.kind) {
    case 'choice':
      return `정답 선택지: ${view.text}`;
    case 'choices':
      return `정답 선택지: ${view.choices.map((c) => c.text).join(' / ')}`;
    case 'text':
      return `정답: ${view.text}`;
    case 'blanks':
      return view.blanks.map((b) => `${b.id}: ${b.answer ?? ''}`).join('\n');
    case 'console':
      return `출력:\n${view.lines.join('\n')}`;
    case 'value':
      return `값: ${view.text}`;
    case 'error':
      return view.thrown ? `오류 발생: ${view.name ?? ''}` : '오류 없음';
    case 'files':
      return view.files.map((f) => `// ${f.path}\n${f.content}`).join('\n\n');
    case 'none':
      return '';
  }
}

/** Text of a lesson body section: from the `Section` marker with `id` to the next marker. */
export function sectionTextOf(body: readonly unknown[], sectionId: string): string | null {
  const text = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const n = node as { type?: unknown; value?: unknown; children?: unknown };
    if (n.type === 'text' || n.type === 'inlineCode' || n.type === 'code') {
      return typeof n.value === 'string' ? n.value : '';
    }
    return Array.isArray(n.children)
      ? n.children.map(text).join(n.type === 'paragraph' ? '' : '\n')
      : '';
  };
  const isSection = (node: unknown, id?: string) => {
    const n = node as { type?: unknown; name?: unknown; props?: { id?: unknown } } | null;
    return (
      n?.type === 'component' && n.name === 'Section' && (id === undefined || n.props?.id === id)
    );
  };
  const start = body.findIndex((n) => isSection(n, sectionId));
  if (start < 0) return null;
  const parts = [text(body[start])];
  for (const node of body.slice(start + 1)) {
    if (isSection(node)) break;
    parts.push(text(node));
  }
  const out = parts
    .filter((p) => p.trim() !== '')
    .join('\n')
    .trim();
  return out === '' ? null : out;
}

export class TutorContextSource implements ContextSource {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;
  readonly #scope: TutorContextScope;

  constructor(userDb: UserDb, content: ContentAccess, scope: TutorContextScope) {
    this.#userDb = userDb;
    this.#content = content;
    this.#scope = scope;
  }

  /** What the hint records allow for an exercise in this scope. */
  recordedAccess(exerciseId: string): ExerciseAccess {
    const state = hintState(
      listHintEvents(this.#userDb.orm, {
        learnerId: this.#scope.learnerId,
        exerciseId,
        itemId: this.#scope.practiceSetItemId,
      }),
    );
    return {
      hintLevel: Math.min(HINT_LEVELS, state.level) as ExerciseAccess['hintLevel'],
      solutionViewed: state.solutionViewed,
    };
  }

  conceptStates(
    conceptIds: readonly string[],
    opts: { includePrerequisites?: boolean } = {},
  ): Promise<ConceptStateContext[]> {
    const requested = [...new Set(conceptIds)];
    if (requested.length === 0 || !this.#content.available) return Promise.resolve([]);
    // Direct prerequisites only (docs: 선수 개념을 직계만 남김).
    const prerequisiteOf = new Map<string, string>();
    if (opts.includePrerequisites) {
      for (const edge of this.#content.repo.listPrerequisites()) {
        if (!requested.includes(edge.conceptId) || requested.includes(edge.prerequisiteId))
          continue;
        if (!prerequisiteOf.has(edge.prerequisiteId)) {
          prerequisiteOf.set(edge.prerequisiteId, edge.conceptId);
        }
      }
    }
    const ids = [...requested, ...prerequisiteOf.keys()];
    const orm = this.#userDb.orm;
    const mastery = new Map(
      orm
        .select()
        .from(conceptMastery)
        .where(
          and(
            eq(conceptMastery.learnerId, this.#scope.learnerId),
            inArray(conceptMastery.conceptId, ids),
          ),
        )
        .all()
        .map((r) => [r.conceptId, r]),
    );
    const memory = new Map(
      orm
        .select({ conceptId: conceptMemory.conceptId, dueAt: conceptMemory.dueAt })
        .from(conceptMemory)
        .where(
          and(
            eq(conceptMemory.learnerId, this.#scope.learnerId),
            inArray(conceptMemory.conceptId, ids),
          ),
        )
        .all()
        .map((r) => [r.conceptId, r.dueAt]),
    );
    const concepts = this.#content.repo.getConcepts(ids);
    return Promise.resolve(
      ids.flatMap((id) => {
        const concept = concepts.get(id);
        if (!concept) return [];
        const m = mastery.get(id);
        const due = memory.get(id);
        return [
          {
            id,
            title: concept.title,
            stage: m?.stage ?? 'not_started',
            mastery: m?.score ?? 0,
            due: due ? localDate(due, this.#scope.timezone, this.#scope.dayStartHour) : null,
            ...(prerequisiteOf.has(id) ? { prerequisiteOf: prerequisiteOf.get(id) ?? '' } : {}),
          },
        ];
      }),
    );
  }

  exercise(exerciseId: string, requested: ExerciseAccess): Promise<ExerciseContext | null> {
    if (!this.#content.available) return Promise.resolve(null);
    const exercise = this.#content.repo.getExercise(exerciseId);
    if (!exercise) return Promise.resolve(null);
    const recorded = this.recordedAccess(exerciseId);
    const access: ExerciseAccess = {
      hintLevel: Math.min(requested.hintLevel, recorded.hintLevel) as ExerciseAccess['hintLevel'],
      solutionViewed: requested.solutionViewed && recorded.solutionViewed,
    };
    const { spec } = loadSpec(exercise);
    const publicSpec = kit(() =>
      redactSpec(exercise.type, spec, {
        shuffleSeed: this.#scope.practiceSetItemId ?? exercise.id,
      }),
    );
    return Promise.resolve({
      id: exercise.id,
      type: exercise.type,
      difficulty: exercise.difficulty,
      prompt: exercise.prompt,
      code: exercise.code,
      publicSpec: JSON.stringify(publicSpec),
      conceptIds: exercise.concepts.map((c) => c.conceptId),
      openedHints: exercise.hints.levels
        .slice(0, access.hintLevel)
        .map((text, i) => ({ level: i + 1, text })),
      solution: access.solutionViewed
        ? {
            explanation: exercise.explanation,
            answer: solutionText(solutionView(exercise.type, spec)),
          }
        : null,
      access,
      origin: exerciseOriginOf(exercise.id) ?? exercise.origin,
    });
  }

  attempts(exerciseId: string, opts: { limit: number }): Promise<AttemptContext[]> {
    const rows = this.#userDb.orm
      .select({ attempt: attempts, answer: submissions.answerJson })
      .from(attempts)
      .leftJoin(submissions, eq(submissions.attemptId, attempts.id))
      .where(
        and(eq(attempts.learnerId, this.#scope.learnerId), eq(attempts.exerciseId, exerciseId)),
      )
      .orderBy(desc(attempts.submittedAt), desc(attempts.id))
      .limit(opts.limit)
      .all();
    return Promise.resolve(
      rows.map(({ attempt, answer }) => {
        const grading = gradingJson.safeParse(attempt.gradingJson);
        return {
          id: attempt.id,
          outcome: attempt.outcome,
          score: attempt.score,
          confidence: attempt.confidence,
          hintLevelMax: attempt.hintLevelMax,
          answerSummary: clip(answer === null ? '' : JSON.stringify(answer), 300),
          // Feedback the learner already saw after grading (no hidden expectations).
          feedback: grading.success
            ? grading.data.feedback.slice(0, 3).map((f) => clip(f.message, 200))
            : [],
          submittedAt: attempt.submittedAt.getTime(),
        };
      }),
    );
  }

  lesson(lessonId: string, opts: { sectionId: string | null }): Promise<LessonContext | null> {
    if (!this.#content.available) return Promise.resolve(null);
    const lesson = this.#content.repo.getLesson(lessonId);
    if (!lesson) return Promise.resolve(null);
    return Promise.resolve({
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
      objectives: lesson.objectives,
      sectionId: opts.sectionId,
      sectionText: opts.sectionId ? sectionTextOf(lesson.body, opts.sectionId) : null,
      concepts: lesson.concepts
        .filter((c) => c.role !== 'linked')
        .map((c) => ({ id: c.id, title: c.title, summary: c.summary })),
    });
  }

  threadMessages(
    threadId: string,
    opts: { limit: number; excludeMessageIds: readonly string[]; after?: number },
  ): Promise<TutorMessageContext[]> {
    return Promise.resolve(
      recentMessages(
        this.#userDb.orm,
        threadId,
        opts.limit,
        opts.excludeMessageIds,
        opts.after,
      ).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.getTime(),
      })),
    );
  }

  /**
   * Active observations (time rules applied at read, learning-engine.md#오개념-상태-전이) of these
   * concepts, confirmed first. AI-proposed rows (`ai.<ULID>`) are included: tutor context is the
   * one place they are used.
   */
  misconceptions(conceptIds: readonly string[]): Promise<MisconceptionContext[]> {
    if (conceptIds.length === 0) return Promise.resolve([]);
    const now = (this.#scope.now ?? Date.now)();
    const active = listObservationsForConcepts(
      this.#userDb.orm,
      this.#scope.learnerId,
      conceptIds,
    ).flatMap(({ state, aiDescription }) => {
      const status = misconceptionStatusAt(defaultEngineConfig, state, now);
      return status === 'suspected' || status === 'confirmed'
        ? [{ state, status, aiDescription }]
        : [];
    });
    const catalog = this.#content.available
      ? new Map(
          this.#content.repo
            .listMisconceptionDetails({
              ids: active
                .map((a) => a.state.misconceptionId)
                .filter((id) => !isAiMisconception(id)),
            })
            .map((m) => [m.id, m]),
        )
      : new Map<string, { title: string; description: string }>();
    const seen = new Set<string>();
    const out: MisconceptionContext[] = [];
    for (const { state, status, aiDescription } of active) {
      if (seen.has(state.misconceptionId)) continue;
      seen.add(state.misconceptionId);
      const ai = isAiMisconception(state.misconceptionId);
      const entry = ai ? null : catalog.get(state.misconceptionId);
      if (!ai && !entry) continue; // removed from the content pack
      const description = ai ? (aiDescription ?? '') : (entry?.description ?? '');
      out.push({
        id: state.misconceptionId,
        conceptId: state.conceptId,
        title: ai ? clip(description, 80) : (entry?.title ?? state.misconceptionId),
        description,
        status,
        origin: ai ? 'ai' : 'catalog',
        evidenceCount: state.evidence.length,
      });
    }
    out.sort((a, b) => (a.status === b.status ? 0 : a.status === 'confirmed' ? -1 : 1));
    return Promise.resolve(out);
  }

  threadSummary(threadId: string): Promise<SessionSummaryContext | null> {
    const row = threadSummary(this.#userDb.orm, this.#scope.learnerId, threadId);
    return Promise.resolve(row ? summaryContext(row) : null);
  }

  pastSummaries(
    conceptIds: readonly string[],
    opts: { limit: number; excludeThreadId: string | null },
  ): Promise<SessionSummaryContext[]> {
    return Promise.resolve(
      pastSummaries(this.#userDb.orm, this.#scope.learnerId, conceptIds, opts).flatMap((row) => {
        const ctx = summaryContext(row);
        return ctx ? [ctx] : [];
      }),
    );
  }
}
