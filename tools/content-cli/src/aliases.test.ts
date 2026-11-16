import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { PUBLISHED_SLUGS_FILE, publishedSlugLines, readPublishedSlugs } from './aliases.ts';
import { buildContent, type ExerciseKitHooks } from './build.ts';
import { checkContent } from './check.ts';
import { EXERCISE, EXERCISE_YAML, LESSON, lessonMdx, writeContent } from './test/fixture.ts';

const kit: ExerciseKitHooks = {
  validateSpec: () => ({ ok: true }),
  redact: (_type, spec) => spec,
  leakFingerprints: () => [],
};

type Files = Record<string, unknown>;
const withAliases =
  (aliases: unknown, more: (f: Files) => void = () => undefined) =>
  (f: Files) => {
    f['aliases.yaml'] = aliases;
    more(f);
  };
const messages = (root: string) =>
  checkContent(root)
    .diagnostics.items.map((d) => `${d.level} ${d.file} ${d.message}`)
    .join('\n');

describe('aliases.yaml', () => {
  it('turns rename, merge and split entries into content_id_aliases rows', () => {
    const root = writeContent(
      withAliases(
        [
          { from: 'js.basics.print', to: 'js.basics.console-log', kind: 'rename' },
          { from: 'js.basics.stmt-a', to: 'js.basics.statement', kind: 'merge' },
          {
            from: 'js.basics.stmt-b',
            to: 'js.basics.statement',
            kind: 'merge',
            since: '2026.12.01.1',
          },
          {
            from: 'js-basics.start.old-intro',
            to: [LESSON, 'js-basics.start.other'],
            kind: 'split',
            primary: LESSON,
          },
        ],
        (f) => {
          // A second lesson so the split has two targets.
          const mod = f['courses/js-basics/modules/01-start/module.yaml'] as Record<
            string,
            unknown
          >;
          mod['lessons'] = ['first-program', 'other'];
          const base = 'courses/js-basics/modules/01-start/lessons';
          f[`${base}/02-other/lesson.yaml`] = {
            ...(f[`${base}/01-first-program/lesson.yaml`] as Record<string, unknown>),
            id: 'js-basics.start.other',
            concepts: { reviewed: ['js.basics.statement'] },
            practice: undefined,
          };
          f[`${base}/02-other/lesson.mdx`] = lessonMdx();
        },
      ),
    );
    const { diagnostics, aliases } = checkContent(root);
    expect(diagnostics.items.filter((d) => d.level === 'error')).toEqual([]);
    expect(aliases).toEqual([
      {
        old_id: 'js.basics.print',
        new_id: 'js.basics.console-log',
        alias_kind: 'rename',
        is_primary: 1,
        entity_kind: 'concept',
        since_pack_version: '2026.11.14.1',
      },
      expect.objectContaining({ old_id: 'js.basics.stmt-a', alias_kind: 'merge', is_primary: 1 }),
      expect.objectContaining({ old_id: 'js.basics.stmt-b', since_pack_version: '2026.12.01.1' }),
      expect.objectContaining({
        new_id: LESSON,
        alias_kind: 'split',
        is_primary: 1,
        entity_kind: 'lesson',
      }),
      expect.objectContaining({ new_id: 'js-basics.start.other', is_primary: 0 }),
    ]);

    const out = join(mkdtempSync(join(tmpdir(), 'proginone-alias-')), 'content.db');
    expect(buildContent(root, out, { kit }).written).toBe(true);
    const db = new Database(out, { readonly: true });
    const rows = db.prepare('SELECT * FROM content_id_aliases ORDER BY old_id, new_id').all();
    db.close();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      old_id: 'js-basics.start.old-intro',
      new_id: LESSON,
      is_primary: 1,
    });
  });

  it.each<[string, unknown, string]>([
    [
      'old slug still in the content',
      [{ from: 'js.basics.statement', to: 'js.basics.console-log', kind: 'rename' }],
      'error aliases.yaml js.basics.statement: 이전 slug가 아직 콘텐츠에 있습니다(개념)',
    ],
    [
      'target missing',
      [{ from: 'js.basics.print', to: 'js.basics.nope', kind: 'rename' }],
      '없는 slug를 가리킵니다: js.basics.nope',
    ],
    [
      'targets of different kinds',
      [
        {
          from: 'js.basics.old',
          to: ['js.basics.statement', LESSON],
          kind: 'split',
          primary: LESSON,
        },
      ],
      'to의 slug 종류가 서로 다릅니다',
    ],
    [
      'old slug shaped like another kind',
      [{ from: 'js-basics.old-module', to: 'js.basics.statement', kind: 'rename' }],
      'from이 개념 slug 형식이 아닙니다',
    ],
    [
      'duplicate from',
      [
        { from: 'js.basics.print', to: 'js.basics.console-log', kind: 'rename' },
        { from: 'js.basics.print', to: 'js.basics.statement', kind: 'rename' },
      ],
      '같은 from이 두 번 있습니다',
    ],
    [
      'split without primary',
      [
        {
          from: 'js.basics.old',
          to: ['js.basics.statement', 'js.basics.console-log'],
          kind: 'split',
        },
      ],
      'split에는 진도를 이어받을 primary가 필요합니다',
    ],
    [
      'rename with two targets',
      [
        {
          from: 'js.basics.old',
          to: ['js.basics.statement', 'js.basics.console-log'],
          kind: 'rename',
        },
      ],
      'rename는 새 slug가 하나여야 합니다',
    ],
    [
      'single merge',
      [{ from: 'js.basics.old', to: 'js.basics.statement', kind: 'merge' }],
      'warning aliases.yaml js.basics.statement: merge 항목이 하나뿐입니다',
    ],
  ])('reports %s', (_name, aliases, expected) => {
    expect(messages(writeContent(withAliases(aliases)))).toContain(expected);
  });

  it('warns when an alias points at an unpublished draft exercise', () => {
    const root = writeContent(
      withAliases([{ from: `${LESSON}.mcq-old`, to: EXERCISE, kind: 'rename' }], (f) => {
        const ex = f[EXERCISE_YAML] as Record<string, unknown>;
        ex['review'] = { status: 'draft', draftedBy: 'ai:claude' };
        // The misconception remediation must reference approved exercises only in builds.
      }),
    );
    expect(messages(root)).toContain(`${EXERCISE}은(는) 아직 공개되지 않습니다`);
  });
});

describe('published slug manifest', () => {
  it('is written by a release build and not by a draft build', () => {
    const root = writeContent();
    const out = join(mkdtempSync(join(tmpdir(), 'proginone-alias-')), 'content.db');
    buildContent(root, out, { kit, includeDrafts: true, updatePublishedSlugs: true });
    expect(existsSync(join(root, PUBLISHED_SLUGS_FILE))).toBe(false);
    buildContent(root, out, { kit, updatePublishedSlugs: true });
    const text = readFileSync(join(root, PUBLISHED_SLUGS_FILE), 'utf8');
    expect(text).toContain(`exercise ${EXERCISE}\n`);
    expect(text).toContain('concept js.basics.console-log\n');
    expect(text).toContain('course js-basics\n');
    expect(readPublishedSlugs(root)?.get(LESSON)).toBe('lesson');
  });

  it('warns about published slugs that disappeared without an alias', () => {
    const root = writeContent();
    const lines = checkContent(root).source;
    writeFileSync(
      join(root, PUBLISHED_SLUGS_FILE),
      [
        '# header',
        ...publishedSlugLines(lines),
        'concept js.basics.gone',
        'lesson js-basics.start.renamed',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'aliases.yaml'),
      '- { from: js-basics.start.renamed, to: js-basics.start.first-program, kind: rename }\n',
    );
    const out = messages(root);
    expect(out).toContain(
      `warning ${PUBLISHED_SLUGS_FILE} 공개했던 개념 js.basics.gone이(가) 사라졌습니다`,
    );
    expect(out).not.toContain('js-basics.start.renamed이(가)');
  });

  it('warns when a published exercise went back to draft', () => {
    const root = writeContent((f) => {
      const ex = f[EXERCISE_YAML] as Record<string, unknown>;
      ex['review'] = { status: 'draft', draftedBy: 'ai:claude' };
    });
    writeFileSync(join(root, PUBLISHED_SLUGS_FILE), `exercise ${EXERCISE}\n`);
    expect(messages(root)).toContain(`공개했던 문제 ${EXERCISE}이(가) 미검토 상태로 돌아가`);
  });
});
