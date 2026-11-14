import { z } from 'zod';

// Slug rules: docs/design/content-and-exercises.md#slug-규칙, data-model.md#식별자-전략.
const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const re = (pattern: string) => new RegExp(`^${pattern}$`);

export const SLUG_MAX = 120;
export const segment = re(SEG);

const slug = (pattern: RegExp, what: string) =>
  z
    .string()
    .max(SLUG_MAX)
    .regex(pattern, { message: `${what} slug 형식이 아닙니다` });

export const courseId = slug(re(SEG), '과정');
export const moduleId = slug(re(`${SEG}\\.${SEG}`), '모듈');
export const lessonId = slug(re(`${SEG}\\.${SEG}\\.${SEG}`), '단원');
/** `<lang>.<area>.<concept>`, e.g. `js.fn.return`. */
export const conceptId = slug(re(`${SEG}\\.${SEG}\\.${SEG}`), '개념');
/** `<lang>.mc.<name>`. */
export const misconceptionId = slug(re(`${SEG}\\.mc\\.${SEG}`), '오개념');
/** `<lesson>.<type-abbr>-<name>`: four dot-separated segments. */
export const exerciseId = slug(re(`${SEG}\\.${SEG}\\.${SEG}\\.${SEG}`), '문제');
export const templateId = slug(re(`${SEG}\\.${SEG}\\.${SEG}\\.t\\.${SEG}`), '템플릿');
export const trackId = slug(re(SEG), '트랙');

/** `<lesson-slug>#<section-or-example-id>`. */
export const lessonAnchor = z
  .string()
  .regex(re(`${SEG}\\.${SEG}\\.${SEG}#${SEG}`), { message: '단원 앵커 형식이 아닙니다' });
