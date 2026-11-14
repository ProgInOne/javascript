import { describe, expect, it } from 'vitest';
import { compileLessonMdx, SECTION_KINDS } from './mdx.ts';

const sections = (inner: Partial<Record<string, string>> = {}) =>
  SECTION_KINDS.map((k) => `<Section kind="${k}">\n${inner[k] ?? `${k} 본문`}\n</Section>`).join(
    '\n\n',
  );

describe('compileLessonMdx', () => {
  it('compiles a complete lesson into a serializable tree', () => {
    const r = compileLessonMdx(
      sections({
        examples:
          '<RunnableExample id="hello" lang="js" predict predictKind="console" concepts={["js.basics.console-log"]}>\n{`console.log("안녕");`}\n</RunnableExample>',
        pitfalls:
          '<Pitfall misconception="js.mc.log-is-return">\n<Wrong>틀림</Wrong>\n<Actual>실제</Actual>\n<Right>바름</Right>\n</Pitfall>',
        check: '<InlineExercise ref="js-basics.start.first-program.mcq-x" />',
        intro: '본문에 **굵게**와 <ConceptLink to="js.basics.statement">문장</ConceptLink>.',
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.sections.map((s) => s.kind)).toEqual([...SECTION_KINDS]);
    expect(r.refs).toEqual({
      exercises: ['js-basics.start.first-program.mcq-x'],
      concepts: ['js.basics.statement', 'js.basics.console-log'],
      misconceptions: ['js.mc.log-is-return'],
      examples: ['hello'],
    });
    const json = JSON.stringify(r.tree);
    expect(json).not.toContain('position');
    expect(json).toContain('"code":"console.log(\\"안녕\\");"');
    expect(r.text).toContain('굵게');
  });

  it.each([
    ['import', 'import x from "y"', 'import/export'],
    ['expression', '값은 {1 + 1}', '표현식'],
    ['raw html as jsx', '<div>hi</div>', '허용되지 않은 컴포넌트'],
    ['script', '<script>alert(1)</script>', '허용되지 않은 컴포넌트'],
    ['unknown prop', '<Callout kind="note" onClick="x">a</Callout>', '없는 속성'],
    ['code prop expression', '<Callout kind={alert(1)}>a</Callout>', 'JSON 리터럴'],
    ['bad enum', '<Callout kind="loud">a</Callout>', 'note | tip'],
    ['missing alt', '<Figure src="a.png" />', 'alt 속성이 필요'],
    [
      'interpolated code',
      '<RunnableExample id="x" lang="js">\n{`${evil}`}\n</RunnableExample>',
      '코드 블록 하나',
    ],
  ])('rejects %s', (_, snippet, message) => {
    const r = compileLessonMdx(sections({ intro: snippet }));
    expect(r.errors.join('\n')).toContain(message);
  });

  it('accepts a fenced code block inside RunnableExample', () => {
    const r = compileLessonMdx(
      sections({
        examples:
          '<RunnableExample id="a" lang="js">\n\n```js\nlet x = 1;\n```\n\n</RunnableExample>',
      }),
    );
    expect(r.errors).toEqual([]);
    expect(JSON.stringify(r.tree)).toContain('let x = 1;');
  });

  it('checks section presence and order', () => {
    const r = compileLessonMdx(
      '<Section kind="intro">a</Section>\n\n<Section kind="objectives">b</Section>',
    );
    const msg = r.errors.join('\n');
    expect(msg).toContain('필수 섹션이 없습니다: <Section kind="principle">');
    expect(msg).toContain('첫 섹션은 objectives');
  });

  it('requires fewer sections for assessments', () => {
    const src = ['objectives', 'practice', 'summary', 'next']
      .map((k) => `<Section kind="${k}">x</Section>`)
      .join('\n\n');
    expect(compileLessonMdx(src, { lessonKind: 'assessment' }).errors).toEqual([]);
  });

  it('rejects duplicate example ids', () => {
    const ex = '<RunnableExample id="a" lang="js">\n{`1`}\n</RunnableExample>';
    expect(compileLessonMdx(sections({ examples: `${ex}\n\n${ex}` })).errors.join()).toContain(
      '중복',
    );
  });

  it('closes emphasis before a Korean particle (CJK-friendly emphasis)', () => {
    const r = compileLessonMdx(
      sections({ intro: '값은 **`21`**이에요. 그리고 **"안녕"**을 출력해요.' }),
    );
    expect(r.errors).toEqual([]);
    const json = JSON.stringify(r.tree);
    expect(json).not.toContain('**');
    expect((json.match(/"type":"strong"/g) ?? []).length).toBe(2);
  });
});
