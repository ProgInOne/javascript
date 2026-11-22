import { describe, expect, it } from 'vitest';
import { docUrlOf, jsConceptSchema, jsCourseSchema } from './schema.ts';

// This repository's language kit over the common content schemas (D-092).
describe('JavaScript language kit schemas', () => {
  const course = {
    id: 'js-basics',
    title: 'JavaScript 기초',
    summary: 's',
    language: 'javascript',
    level: 'intro',
    objectives: ['o'],
    modules: ['start'],
  };
  const concept = { id: 'js.fn.return', title: 'return', importance: 'core', summary: 's' };

  it('serves only html, css and javascript courses', () => {
    expect(jsCourseSchema.safeParse(course).success).toBe(true);
    expect(jsCourseSchema.safeParse({ ...course, language: 'go' }).success).toBe(false);
  });

  it('adds the MDN path and builds the reference URL from it', () => {
    const c = jsConceptSchema.parse({
      ...concept,
      mdn: 'Web/JavaScript/Reference/Statements/return',
    });
    expect(docUrlOf(c)).toBe(
      'https://developer.mozilla.org/ko/docs/Web/JavaScript/Reference/Statements/return',
    );
    expect(docUrlOf(jsConceptSchema.parse(concept))).toBeNull();
    expect(jsConceptSchema.safeParse({ ...concept, mdn: 'https://example.com' }).success).toBe(
      false,
    );
  });
});
