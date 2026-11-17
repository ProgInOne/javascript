import { describe, expect, it } from 'vitest';
import type { ContentExercise } from '../../db/content/repository.ts';
import { candidateOf } from './engine.ts';

function exercise(over: Partial<ContentExercise>): ContentExercise {
  return {
    id: 'c.lesson.ex',
    type: 'web_task',
    difficulty: 2,
    lessonId: 'c.lesson',
    usage: 'practice',
    variantGroup: null,
    prompt: '문제',
    code: null,
    spec: {},
    hints: { v: 1, levels: [] },
    explanation: '',
    estimatedSeconds: 60,
    origin: 'authored',
    contentHash: 'h1',
    concepts: [{ conceptId: 'c.a', weight: 1, isPrimary: true }],
    misconceptionIds: [],
    workedExampleStage: null,
    leakFingerprints: [],
    ...over,
  };
}

const webSpec = (starter: string) => ({
  focus: 'html',
  starter: { files: [{ path: 'index.html', content: starter }] },
  solution: { files: [{ path: 'index.html', content: '<h1>안녕</h1>\n' }] },
  checks: [{ kind: 'dom', id: 'h1', selector: 'h1', expect: { exists: true } }],
});

describe('candidateOf writing flag (D-084)', () => {
  it('marks a web_task with an empty starter as writing', () => {
    const blank = candidateOf(exercise({ id: 'a', spec: webSpec('<!-- 여기에 -->\n') }));
    expect(blank?.writing).toBe(true);
    const edit = candidateOf(exercise({ id: 'b', spec: webSpec('<p>고칠 문서</p>\n') }));
    expect(edit?.writing).toBeUndefined();
  });

  it('never marks recognition or recall types, and tolerates a broken spec', () => {
    expect(candidateOf(exercise({ id: 'c', type: 'true_false', spec: {} }))?.writing).toBe(
      undefined,
    );
    expect(candidateOf(exercise({ id: 'd', spec: { focus: 'html' } }))?.writing).toBe(undefined);
  });
});
