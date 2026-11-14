/**
 * ts-fsrs v6 implementation of {@link FsrsPort}. This is the only file that imports ts-fsrs, so a
 * library upgrade stays contained here.
 */
import type { DefaultSchedulerCardInput } from 'ts-fsrs';
import { DefaultScheduler, Rating, State } from 'ts-fsrs';
import type { EngineConfig } from '../config.ts';
import type {
  FsrsCard,
  FsrsCardState,
  FsrsLog,
  FsrsPort,
  FsrsRating,
  JsonObject,
  JsonValue,
} from '../types.ts';
import { DAY_MS } from '../util/time.ts';

type LibCard = DefaultSchedulerCardInput;

const RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const satisfies Record<FsrsRating, Rating>;

const STATE_NAMES: Record<number, FsrsCardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

/** Date fields of ts-fsrs cards and revlogs, stored as epoch ms. */
const DATE_FIELDS = new Set(['dueAt', 'lastReviewAt', 'reviewTime']);

function stateName(value: unknown): FsrsCardState {
  const name = typeof value === 'number' ? STATE_NAMES[value] : undefined;
  if (name === undefined) throw new Error(`unknown FSRS state: ${String(value)}`);
  return name;
}

/** Library object → JSON-safe object (Date → epoch ms). */
function toJson(value: object): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (field instanceof Date) out[key] = field.getTime();
    else if (
      field === null ||
      typeof field === 'string' ||
      typeof field === 'number' ||
      typeof field === 'boolean'
    ) {
      out[key] = field;
    }
  }
  return out;
}

function requireNumber(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`card_json.${key} must be a finite number`);
  }
  return value;
}

/** JSON-safe object → library card (epoch ms → Date). */
function toLibCard(raw: unknown): LibCard {
  if (raw === null || typeof raw !== 'object') throw new Error('card_json must be an object');
  const record = raw as Record<string, unknown>;
  for (const key of [
    'stability',
    'stabilityFast',
    'difficulty',
    'state',
    'reps',
    'lapses',
    'dueAt',
  ]) {
    requireNumber(record, key);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = DATE_FIELDS.has(key) && typeof value === 'number' ? new Date(value) : value;
  }
  return out as unknown as LibCard;
}

function toCard(raw: JsonObject): FsrsCard {
  const record = raw as Record<string, unknown>;
  const lastReviewAt = record['lastReviewAt'];
  return {
    raw,
    dueAt: requireNumber(record, 'dueAt'),
    stability: requireNumber(record, 'stability'),
    difficulty: requireNumber(record, 'difficulty'),
    state: stateName(record['state']),
    lastReviewAt: typeof lastReviewAt === 'number' ? lastReviewAt : null,
    reps: requireNumber(record, 'reps'),
    lapses: requireNumber(record, 'lapses'),
  };
}

/**
 * Creates the FSRS port. Scheduler creation is asynchronous in ts-fsrs v6, so the server calls
 * this once at start-up and injects the port; every method of the port is synchronous and
 * deterministic (fuzz is seeded by the card ID and review count).
 */
export async function createTsFsrsPort(options: EngineConfig['fsrs']): Promise<FsrsPort> {
  const scheduler = await DefaultScheduler({
    version: options.version,
    desiredRetention: options.desiredRetention,
    maximumInterval: options.maximumInterval,
    enableFuzz: options.enableFuzz,
    enableShortTerm: options.enableShortTerm,
  });

  return {
    modelVersion: options.version,
    newCard(cardId, now) {
      return toCard(toJson(scheduler.newCard({ now: new Date(now), cardId })));
    },
    review(card, rating, now) {
      const result = scheduler.review({
        card: toLibCard(card.raw),
        grade: RATING[rating],
        now: new Date(now),
      });
      const log: FsrsLog = {
        raw: toJson(result.revlog),
        elapsedDays: card.lastReviewAt === null ? 0 : (now - card.lastReviewAt) / DAY_MS,
        scheduledDays: result.revlog.scheduledDays,
        stateBefore: card.state,
      };
      return { card: toCard(toJson(result.card)), log };
    },
    retrievability(card, now) {
      if (card.lastReviewAt === null) return 0;
      const elapsedDays = Math.max(0, (now - card.lastReviewAt) / DAY_MS);
      return scheduler.model.forgettingCurve(toLibCard(card.raw), elapsedDays);
    },
    fromRaw(raw) {
      return toCard(toJson(toLibCard(raw)));
    },
  };
}
