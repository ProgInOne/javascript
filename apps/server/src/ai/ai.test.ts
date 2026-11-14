import { leakFingerprints } from '@proginone/exercise-kit';
import { describe, expect, it } from 'vitest';
import { ANSWER_MARKERS, EX, FIXTURE_EXERCISES } from '../test/content-fixture.ts';
import { practiceApp } from '../test/practice-app.ts';
import { sectionTextOf, TutorContextSource } from './context-source.ts';
import { leakGuard } from './leak-guard.ts';

const LEARNER = '01JD3Z8Q6V2K9M4T7R1X5W0BNC';

describe('leakGuard', () => {
  it('matches normalized fingerprints and reports labels, never the answer', () => {
    const guard = leakGuard(["return s.toUpperCase() + '!';", 'HI!', '2']);
    expect(guard).not.toBeNull();
    if (!guard) return;
    expect(guard.findViolations('정답은   return s.toUpperCase()  +  ‘!’; 입니다')).toEqual([
      'fp:0',
    ]);
    // Short fingerprints match whole tokens only; very short ones are ignored.
    expect(guard.findViolations('HI! 라고 외쳐요')).toEqual(['fp:1']);
    expect(guard.findViolations('CHI!')).toEqual([]);
    expect(guard.findViolations('1 + 1 = 2')).toEqual([]);
    expect(guard.holdback).toBeGreaterThan("return s.toUpperCase() + '!';".length);
  });

  it('returns null when nothing is checkable', () => {
    expect(leakGuard([])).toBeNull();
    expect(leakGuard(['a', ';'])).toBeNull();
  });

  it('catches the fixture solution line', () => {
    const ex = FIXTURE_EXERCISES.find((e) => e.id === EX.fixBug);
    if (!ex) throw new Error('fixture');
    const guard = leakGuard(leakFingerprints(ex.type, ex.spec));
    expect(guard?.findViolations("  return s.toUpperCase() + '!'; // SOLUTION-MARK")).toHaveLength(
      1,
    );
  });
});

describe('TutorContextSource', () => {
  it('clamps requested access to the hint records (D-010)', async () => {
    const ctx = await practiceApp();
    const source = new TutorContextSource(ctx.userDb, ctx.content, {
      learnerId: LEARNER,
      timezone: 'Asia/Seoul',
      dayStartHour: 4,
      practiceSetItemId: null,
    });
    const forged = await source.exercise(EX.implement, { hintLevel: 3, solutionViewed: true });
    expect(forged?.access).toEqual({ hintLevel: 0, solutionViewed: false });
    expect(forged?.openedHints).toEqual([]);
    expect(forged?.solution).toBeNull();
    const text = JSON.stringify(forged);
    for (const marker of ANSWER_MARKERS) expect(text).not.toContain(marker);

    await ctx.call('POST', `/exercises/${EX.implement}/hints`, {});
    const one = await source.exercise(EX.implement, { hintLevel: 3, solutionViewed: true });
    expect(one?.access).toEqual({ hintLevel: 1, solutionViewed: false });
    expect(one?.openedHints).toEqual([{ level: 1, text: '힌트 1' }]);
  });

  it('reads concept states, attempts and lesson sections', async () => {
    const ctx = await practiceApp();
    const source = new TutorContextSource(ctx.userDb, ctx.content, {
      learnerId: LEARNER,
      timezone: 'Asia/Seoul',
      dayStartHour: 4,
      practiceSetItemId: null,
    });
    expect(await source.conceptStates(['js.basics.statement', 'missing'])).toEqual([
      {
        id: 'js.basics.statement',
        title: 'js.basics.statement',
        stage: 'not_started',
        mastery: 0,
        due: null,
      },
    ]);
    expect(await source.attempts(EX.mcq, { limit: 5 })).toEqual([]);
    const lesson = await source.lesson('js-basics.start.first-program', {
      sectionId: 'objectives',
    });
    expect(lesson).toMatchObject({ title: '단원 0', sectionText: '문장은 주석' });
  });
});

describe('sectionTextOf', () => {
  it('collects text from a Section marker to the next one', () => {
    const body = [
      { type: 'component', name: 'Section', props: { id: 'a' }, children: [] },
      { type: 'paragraph', children: [{ type: 'text', value: 'A 본문' }] },
      { type: 'component', name: 'Section', props: { id: 'b' }, children: [] },
      { type: 'paragraph', children: [{ type: 'text', value: 'B 본문' }] },
    ];
    expect(sectionTextOf(body, 'a')).toBe('A 본문');
    expect(sectionTextOf(body, 'b')).toBe('B 본문');
    expect(sectionTextOf(body, 'c')).toBeNull();
  });
});
