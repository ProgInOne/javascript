import {
  AIError,
  errorForStatus,
  explainMistake,
  isAIError,
  misconceptionPropose,
  verifyProposals,
  type AICallRecord,
  type TaskRunner,
  type ValidationIssue,
  type VerifiedProposal,
} from '@proginone/ai';
import {
  AI_MISCONCEPTION_PREFIX,
  defaultEngineConfig,
  proposeMisconception,
  type MisconceptionEvidence,
} from '@proginone/learning-engine';
import type { ErrorCode, MistakeExplanation } from '@proginone/shared';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { TutorContextSource } from '../../ai/context-source.ts';
import { leakGuard } from '../../ai/leak-guard.ts';
import type { UserDb } from '../../db/user/connection.ts';
import { findItem } from '../../db/user/exercise-records.ts';
import { ensureLearner, newId, type Learner } from '../../db/user/learners.ts';
import { loadObservations, writeObservation } from '../../db/user/misconceptions.ts';
import { aiCalls, attempts } from '../../db/user/schema.ts';
import { insertAiCall } from '../../db/user/tutor.ts';
import { aiAppError, AppError } from '../../http/errors.ts';
import type { Logger } from '../../observability/logger.ts';
import type { AiService } from '../ai/ai-service.ts';
import type { Clock } from '../clock.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';

// evaluator.explainMistake and misconception.propose (docs/design/ai-system.md#evaluatorexplainmistake,
// #misconceptionpropose). The service decides what the AI may see (hint records, D-010) and what
// of its output is kept: proposals are recorded only through the learning engine's
// `proposeMisconception`, as `suspected`, with wrong attempts as evidence (FR-AI-09).

const WRONG_OUTCOMES = ['partial', 'incorrect'] as const;
/** Proposals look at wrong attempts of the last week (docs: 같은 개념에서 오답 2회 이상). */
export const PROPOSAL_WINDOW_MS = 7 * 86_400_000;
const EXPLANATION_CACHE_SIZE = 200;

export interface EvaluatorDeps {
  userDb: UserDb;
  content: ContentAccess;
  runner: TaskRunner;
  ai: AiService;
  now: Clock;
  log: Logger;
}

export interface ProposalResult {
  conceptId: string;
  recorded: { misconceptionId: string; status: string; origin: 'catalog' | 'ai' }[];
  /** Why proposals were dropped (also stored in `ai_calls.validation_issues_json`). */
  issues: ValidationIssue[];
}

export class EvaluatorService {
  readonly #deps: EvaluatorDeps;
  readonly #explanations = new Map<string, MistakeExplanation>();

  constructor(deps: EvaluatorDeps) {
    this.#deps = deps;
  }

  #learner(): Learner {
    return ensureLearner(this.#deps.userDb);
  }

  #source(learner: Learner, itemId: string | null) {
    return new TutorContextSource(this.#deps.userDb, this.#deps.content, {
      learnerId: learner.id,
      timezone: learner.timezone,
      dayStartHour: learner.dayStartHour,
      practiceSetItemId: itemId,
      now: this.#deps.now,
    });
  }

  // ── evaluator.explainMistake ────────────────────────────────────────────────

  /**
   * `POST /attempts/:id/explanation`. Falls back to the authored misconception descriptions
   * whenever AI cannot give a checked explanation, so it never blocks learning.
   */
  async explainMistake(attemptId: string): Promise<MistakeExplanation> {
    const learner = this.#learner();
    const orm = this.#deps.userDb.orm;
    const row = orm
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.learnerId, learner.id)))
      .get();
    if (!row) {
      throw new AppError('NOT_FOUND', 404, '시도를 찾을 수 없습니다.', { details: { attemptId } });
    }
    if (row.outcome === 'correct') {
      throw new AppError('ATTEMPT_CORRECT', 409, '맞힌 시도는 오답 분석을 하지 않습니다.');
    }
    if (row.practiceSetItemId) {
      const found = findItem(orm, learner.id, row.practiceSetItemId);
      // Results are withheld until the assessment ends (learning-engine.md#단원-평가-세트).
      if (found?.setKind === 'assessment' && found.setStatus === 'active') {
        throw aiAppError(new AIError('AI_LOCKED_IN_ASSESSMENT'));
      }
    }
    const cached = this.#explanations.get(attemptId);
    if (cached) return cached;
    const exercise = this.#deps.content.available
      ? this.#deps.content.repo.getExercise(row.exerciseId)
      : null;
    if (!exercise) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', {
        details: { id: row.exerciseId },
      });
    }
    const source = this.#source(learner, row.practiceSetItemId);
    const access = source.recordedAccess(exercise.id);
    const observed = (row.misconceptionIdsJson as string[] | null) ?? [];
    const fallback = (code: ErrorCode): MistakeExplanation => {
      const details = this.#deps.content.repo.listMisconceptionDetails({ ids: observed });
      return {
        attemptId,
        source: 'authored',
        fallbackCode: code,
        summary: details[0]?.title ?? '',
        explanationMarkdown: details
          .map((m) => `**${m.title}**\n\n${m.description}\n\n${m.correction}`)
          .join('\n\n'),
        mistakeKind: null,
        nextStep: null,
        relatedConcepts: [],
        misconception: null,
      };
    };
    const store = (record: AICallRecord) => {
      insertAiCall(orm, {
        id: newId(),
        learnerId: learner.id,
        record,
        subjectType: 'attempt',
        subjectId: attemptId,
      });
    };

    const statusError = errorForStatus(await this.#deps.ai.provider.connect());
    if (statusError) return fallback(statusError.code);

    const guard = access.solutionViewed ? null : leakGuard(exercise.leakFingerprints);
    try {
      const result = await this.#deps.runner.run(
        explainMistake,
        { attemptId, exerciseId: exercise.id, access },
        { source, ...(guard ? { guard } : {}) },
      );
      if (result.status !== 'ok' || !result.output) {
        store({ ...result.record, status: 'fallback' });
        return this.#remember(fallback('AI_BAD_OUTPUT'));
      }
      const out = result.output;
      const concepts = this.#deps.content.repo.getConcepts(out.relatedConceptIds);
      let misconception: MistakeExplanation['misconception'] = null;
      const issues: ValidationIssue[] = [];
      if (out.misconceptionCandidate) {
        // Same acceptance rules as misconception.propose (docs: 반영), evidence = this attempt.
        const conceptId =
          exercise.concepts.find((c) => c.isPrimary)?.conceptId ?? exercise.concepts[0]?.conceptId;
        const catalogId = out.misconceptionCandidate.catalogId;
        const conceptOfCatalog = catalogId
          ? this.#deps.content.repo.listMisconceptionDetails({ ids: [catalogId] })[0]?.conceptId
          : undefined;
        const target = conceptOfCatalog ?? conceptId;
        if (target) {
          const recorded = this.#applyProposals(
            learner.id,
            target,
            [
              {
                catalogId,
                newDescription: catalogId ? null : out.misconceptionCandidate.description,
                conceptId: target,
                evidenceAttemptIds: [attemptId],
                confidence: 'medium',
              },
            ],
            issues,
          );
          misconception = recorded[0] ?? null;
        }
      }
      store({
        ...result.record,
        validationIssues: [...result.record.validationIssues, ...issues].slice(0, 20),
      });
      return this.#remember({
        attemptId,
        source: 'ai',
        fallbackCode: null,
        summary: out.summary,
        explanationMarkdown: out.explanationMarkdown,
        mistakeKind: out.mistakeKind,
        nextStep: out.nextStep,
        relatedConcepts: out.relatedConceptIds.flatMap((id) => {
          const c = concepts.get(id);
          return c ? [{ id, title: c.title }] : [];
        }),
        misconception,
      });
    } catch (e) {
      if (!isAIError(e)) throw e;
      if (e.record)
        store({ ...e.record, status: e.code === 'AI_BAD_OUTPUT' ? 'fallback' : e.record.status });
      this.#deps.log.warn({ code: e.code, attemptId }, 'evaluator.explainMistake fell back');
      return fallback(e.code);
    }
  }

  #remember(explanation: MistakeExplanation): MistakeExplanation {
    if (this.#explanations.size >= EXPLANATION_CACHE_SIZE) {
      const oldest = this.#explanations.keys().next().value;
      if (oldest !== undefined) this.#explanations.delete(oldest);
    }
    this.#explanations.set(explanation.attemptId, explanation);
    return explanation;
  }

  /**
   * Verifies proposals against the learner's wrong attempts and the catalog, then records them
   * through the learning engine. Returns what was recorded (or already active).
   */
  #applyProposals(
    learnerId: string,
    conceptId: string,
    raw: {
      catalogId: string | null;
      newDescription: string | null;
      conceptId: string;
      evidenceAttemptIds: string[];
      confidence: VerifiedProposal['confidence'];
    }[],
    issues: ValidationIssue[],
  ): NonNullable<MistakeExplanation['misconception']>[] {
    const orm = this.#deps.userDb.orm;
    const ids = [...new Set(raw.flatMap((p) => p.evidenceAttemptIds))];
    const wrong = ids.length
      ? orm
          .select({ id: attempts.id, exerciseId: attempts.exerciseId, at: attempts.submittedAt })
          .from(attempts)
          .where(
            and(
              eq(attempts.learnerId, learnerId),
              inArray(attempts.id, ids),
              inArray(attempts.outcome, [...WRONG_OUTCOMES]),
            ),
          )
          .all()
      : [];
    const catalog = new Map(
      this.#deps.content.repo
        .listMisconceptionDetails({
          ids: raw.flatMap((p) => (p.catalogId ? [p.catalogId] : [])),
          conceptIds: [conceptId],
        })
        .map((m) => [m.id, m]),
    );
    const verified = verifyProposals(
      { proposals: raw.map((p) => ({ ...p, reasoning: '' })) },
      {
        conceptId,
        wrongAttemptIds: new Set(wrong.map((w) => w.id)),
        catalog: new Map([...catalog.values()].map((m) => [m.id, m.conceptId])),
      },
    );
    issues.push(...verified.issues);
    const facts = new Map(wrong.map((w) => [w.id, w]));
    const now = this.#deps.now();
    const out: NonNullable<MistakeExplanation['misconception']>[] = [];
    for (const p of verified.proposals) {
      const evidence: MisconceptionEvidence[] = p.evidenceAttemptIds.flatMap((id) => {
        const f = facts.get(id);
        return f
          ? [{ attemptId: id, exerciseId: f.exerciseId, at: f.at.getTime(), source: 'ai' }]
          : [];
      });
      if (p.catalogId) {
        const stored = loadObservations(orm, learnerId, [p.catalogId]).get(p.catalogId) ?? null;
        const update = proposeMisconception(defaultEngineConfig, {
          misconceptionId: p.catalogId,
          conceptId: p.conceptId,
          evidence,
          state: stored?.state ?? null,
          now,
        });
        if (update) writeObservation(orm, learnerId, stored?.rowId ?? null, update);
        const status = update?.after.status ?? stored?.state.status ?? 'suspected';
        out.push({
          id: p.catalogId,
          title: catalog.get(p.catalogId)?.title ?? p.catalogId,
          status,
          origin: 'catalog',
        });
        continue;
      }
      const description = p.description ?? '';
      const misconceptionId = `${AI_MISCONCEPTION_PREFIX}${newId()}`;
      const update = proposeMisconception(defaultEngineConfig, {
        misconceptionId,
        conceptId: p.conceptId,
        evidence,
        state: null,
        now,
      });
      if (!update) continue;
      writeObservation(orm, learnerId, null, update, description);
      out.push({ id: misconceptionId, title: description, status: 'suspected', origin: 'ai' });
    }
    return out;
  }

  // ── misconception.propose ───────────────────────────────────────────────────

  /**
   * Proposes misconceptions for a concept from the learner's recent wrong attempts (and
   * conversation signals). Returns `null` when there is nothing to cite or AI is not ready.
   */
  async proposeMisconceptions(
    conceptId: string,
    opts: { signals?: string[]; background?: boolean } = {},
  ): Promise<ProposalResult | null> {
    const learner = this.#learner();
    const orm = this.#deps.userDb.orm;
    const candidates = this.#wrongAttempts(learner.id, conceptId);
    const latest = candidates[0];
    if (!latest) return null;
    const provider = this.#deps.ai.provider;
    const status = opts.background ? provider.currentStatus() : await provider.connect();
    if (errorForStatus(status)) return null;
    const attemptIds = candidates.map((c) => c.id);
    const store = (record: AICallRecord) => {
      insertAiCall(orm, {
        id: newId(),
        learnerId: learner.id,
        record,
        subjectType: 'attempt',
        subjectId: latest.id,
      });
    };
    try {
      const result = await this.#deps.runner.run(
        misconceptionPropose,
        { conceptId, attemptIds, signals: (opts.signals ?? []).slice(0, 5) },
        { source: this.#source(learner, null) },
      );
      const issues: ValidationIssue[] = [];
      const output = result.output ?? { proposals: [] };
      const recorded = this.#applyProposals(learner.id, conceptId, output.proposals, issues).map(
        (m) => ({ misconceptionId: m.id, status: m.status, origin: m.origin }),
      );
      store({
        ...result.record,
        validationIssues: [...result.record.validationIssues, ...issues].slice(0, 20),
      });
      this.#deps.log.info(
        { conceptId, recorded: recorded.length, dropped: issues.length },
        'misconception.propose applied',
      );
      return { conceptId, recorded, issues };
    } catch (e) {
      if (!isAIError(e)) throw e;
      if (e.record) store(e.record);
      this.#deps.log.warn({ code: e.code, conceptId }, 'misconception.propose failed');
      return null;
    }
  }

  /** Recent wrong, engine-applied attempts on exercises of a concept, newest first (max 10). */
  #wrongAttempts(learnerId: string, conceptId: string) {
    const rows = this.#deps.userDb.orm
      .select({
        id: attempts.id,
        exerciseId: attempts.exerciseId,
        confidence: attempts.confidence,
        at: attempts.submittedAt,
      })
      .from(attempts)
      .where(
        and(
          eq(attempts.learnerId, learnerId),
          inArray(attempts.outcome, [...WRONG_OUTCOMES]),
          eq(attempts.engineApplied, true),
          gte(attempts.submittedAt, new Date(this.#deps.now() - PROPOSAL_WINDOW_MS)),
        ),
      )
      .orderBy(desc(attempts.submittedAt), desc(attempts.id))
      .limit(100)
      .all();
    if (!this.#deps.content.available || rows.length === 0) return [];
    const exercises = new Map(
      this.#deps.content.repo
        .getExercises([...new Set(rows.map((r) => r.exerciseId))])
        .map((e) => [e.id, e.concepts.map((c) => c.conceptId)]),
    );
    return rows.filter((r) => exercises.get(r.exerciseId)?.includes(conceptId)).slice(0, 10);
  }

  /**
   * Concepts due for a proposal (docs: 트리거): two wrong attempts in the last week, or one wrong
   * attempt answered with `sure`, whose newest wrong attempt was not analyzed yet.
   */
  dueProposalConcepts(): string[] {
    const learner = this.#learner();
    const orm = this.#deps.userDb.orm;
    const rows = orm
      .select({
        id: attempts.id,
        exerciseId: attempts.exerciseId,
        confidence: attempts.confidence,
      })
      .from(attempts)
      .where(
        and(
          eq(attempts.learnerId, learner.id),
          inArray(attempts.outcome, [...WRONG_OUTCOMES]),
          eq(attempts.engineApplied, true),
          gte(attempts.submittedAt, new Date(this.#deps.now() - PROPOSAL_WINDOW_MS)),
        ),
      )
      .orderBy(desc(attempts.submittedAt), desc(attempts.id))
      .limit(200)
      .all();
    if (rows.length === 0 || !this.#deps.content.available) return [];
    const analyzed = new Set(
      orm
        .select({ subjectId: aiCalls.subjectId })
        .from(aiCalls)
        .where(
          and(
            eq(aiCalls.learnerId, learner.id),
            eq(aiCalls.taskName, misconceptionPropose.name),
            sql`${aiCalls.subjectId} IS NOT NULL`,
          ),
        )
        .all()
        .map((r) => r.subjectId),
    );
    const concepts = new Map(
      this.#deps.content.repo
        .getExercises([...new Set(rows.map((r) => r.exerciseId))])
        .map((e) => [e.id, e.concepts.filter((c) => c.isPrimary).map((c) => c.conceptId)]),
    );
    const byConcept = new Map<string, typeof rows>();
    for (const row of rows) {
      for (const c of concepts.get(row.exerciseId) ?? []) {
        byConcept.set(c, [...(byConcept.get(c) ?? []), row]);
      }
    }
    return [...byConcept.entries()]
      .filter(([, list]) => {
        const newest = list[0];
        if (!newest || analyzed.has(newest.id)) return false;
        return list.length >= 2 || list.some((r) => r.confidence === 'sure');
      })
      .map(([conceptId]) => conceptId);
  }
}
