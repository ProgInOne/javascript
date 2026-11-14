import { beforeAll, describe, expect, it } from 'vitest';
import { defaultEngineConfig } from '../config.ts';
import type { FsrsPort } from '../types.ts';
import { DAY_MS } from '../util/time.ts';
import { createTsFsrsPort } from './fsrs-adapter.ts';

const NOW = Date.UTC(2026, 2, 2, 1, 0, 0);
let fsrs: FsrsPort;

beforeAll(async () => {
  fsrs = await createTsFsrsPort(defaultEngineConfig.fsrs);
});

describe('ts-fsrs adapter', () => {
  it('pins FSRS-7 and creates new cards keyed by the concept ID', () => {
    expect(fsrs.modelVersion).toBe('FSRS-7');
    const card = fsrs.newCard('js.values.let', NOW);
    expect(card).toMatchObject({
      state: 'new',
      dueAt: NOW,
      lastReviewAt: null,
      reps: 0,
      lapses: 0,
    });
    expect(card.raw['cardId']).toBe('js.values.let');
  });

  it('schedules a first good review in whole days without short-term steps', () => {
    const { card, log } = fsrs.review(fsrs.newCard('c', NOW), 'good', NOW);
    expect(card.state).toBe('review');
    expect(card.lastReviewAt).toBe(NOW);
    expect((card.dueAt - NOW) % DAY_MS).toBe(0);
    expect(card.dueAt - NOW).toBeGreaterThanOrEqual(DAY_MS);
    expect(log).toMatchObject({ elapsedDays: 0, scheduledDays: 0, stateBefore: 'new' });
  });

  it('is deterministic for the same card, rating and time (fuzz seeded by card ID)', () => {
    const run = () => {
      let card = fsrs.newCard('js.values.const', NOW);
      let at = NOW;
      for (const rating of ['good', 'good', 'hard', 'good'] as const) {
        card = fsrs.review(card, rating, at).card;
        at = card.dueAt;
      }
      return card;
    };
    expect(run()).toEqual(run());
  });

  it('round-trips card_json through JSON and keeps scheduling identically', () => {
    const first = fsrs.review(fsrs.newCard('c', NOW), 'good', NOW).card;
    const restored = fsrs.fromRaw(JSON.parse(JSON.stringify(first.raw)));
    expect(restored).toEqual(first);
    const at = first.dueAt;
    expect(fsrs.review(restored, 'good', at)).toEqual(fsrs.review(first, 'good', at));
    expect(fsrs.retrievability(restored, at + DAY_MS)).toBe(
      fsrs.retrievability(first, at + DAY_MS),
    );
  });

  it('gives retrievability near desired retention at the due date and falling afterwards', () => {
    let card = fsrs.review(fsrs.newCard('c', NOW), 'good', NOW).card;
    card = fsrs.review(card, 'good', card.dueAt).card;
    const atDue = fsrs.retrievability(card, card.dueAt);
    expect(atDue).toBeGreaterThan(0.8);
    expect(atDue).toBeLessThan(0.97);
    expect(fsrs.retrievability(card, card.dueAt + 60 * DAY_MS)).toBeLessThan(atDue);
    expect(fsrs.retrievability(card, card.lastReviewAt ?? 0)).toBeCloseTo(1, 4);
  });

  it('caps intervals at 365 days', () => {
    let card = fsrs.newCard('c', NOW);
    let at = NOW;
    for (let i = 0; i < 12; i++) {
      card = fsrs.review(card, 'easy', at).card;
      expect(card.dueAt - at).toBeLessThanOrEqual(365 * DAY_MS);
      at = card.dueAt;
    }
  });

  it('counts a lapse and enters relearning on again', () => {
    let card = fsrs.review(fsrs.newCard('c', NOW), 'good', NOW).card;
    const lapse = fsrs.review(card, 'again', card.dueAt);
    card = lapse.card;
    expect(card.state).toBe('relearning');
    expect(card.lapses).toBe(1);
    expect(lapse.log.stateBefore).toBe('review');
  });

  it('rejects malformed card_json', () => {
    expect(() => fsrs.fromRaw(null)).toThrow();
    expect(() => fsrs.fromRaw({ stability: 'x' })).toThrow();
  });
});
