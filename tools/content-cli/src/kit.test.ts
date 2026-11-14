import { describe, expect, it } from 'vitest';
import { exerciseKit } from './kit.ts';

const mcq = {
  options: [
    { id: 'a', text: '콘솔에 출력한다' },
    { id: 'b', text: '값을 저장한다', misconception: 'js.mc.log-is-return' },
    { id: 'c', text: '함수를 끝낸다' },
  ],
  correct: 'a',
};

describe('exerciseKit (content-cli wiring)', () => {
  it('rejects unknown types and invalid specs', () => {
    expect(exerciseKit.validateSpec('nope', {}).ok).toBe(false);
    expect(exerciseKit.validateSpec('mcq_single', { options: [] }).ok).toBe(false);
  });

  it('redacts answer keys', () => {
    const check = exerciseKit.validateSpec('mcq_single', mcq);
    if (!check.ok) throw new Error(check.errors.join('\n'));
    const pub = JSON.stringify(exerciseKit.redact('mcq_single', mcq));
    expect(pub).toContain('콘솔에 출력한다');
    expect(pub).not.toContain('"correct"');
    expect(pub).not.toContain('misconception');
  });
});
