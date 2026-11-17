import { describe, expect, it } from 'vitest';
import { namingWarning, transliteratedNames } from './naming.ts';

describe('transliteratedNames', () => {
  it('finds browser, language and tool names written in Hangul', () => {
    expect(transliteratedNames('브라우저(크롬, 엣지, 사파리 등)')).toEqual([
      'Chrome',
      'Safari',
      'Edge',
    ]);
    expect(transliteratedNames('자바스크립트와 타입스크립트, VS 코드, 깃허브')).toEqual([
      'JavaScript',
      'TypeScript',
      'GitHub',
      'VS Code',
    ]);
  });

  it('leaves official spellings, "엣지 케이스" and code alone', () => {
    expect(transliteratedNames('브라우저(Chrome, Edge, Safari 등)에서 JavaScript를')).toEqual([]);
    expect(transliteratedNames('엣지 케이스를 확인해요')).toEqual([]);
    expect(transliteratedNames('`"크롬"`을 출력해요\n```js\nconsole.log("사파리");\n```')).toEqual(
      [],
    );
  });
});

describe('namingWarning', () => {
  it('names the field and the official spelling', () => {
    expect(namingWarning('prompt', '크롬에서 열어 보세요')).toBe(
      'prompt: 제품·언어 이름은 공식 영문으로 씁니다(Chrome)',
    );
    expect(namingWarning('prompt', 'Chrome에서 열어 보세요')).toBeNull();
  });
});
