import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { writeContentDb } from '../../test/content-fixture.ts';
import { setupDb } from '../../test/helpers.ts';
import { ContentRepository } from '../content/repository.ts';
import {
  aliasFingerprint,
  ALIASES_APPLIED_KEY,
  resolveAliases,
  resolveContentAliases,
  type ContentAlias,
} from './content-aliases.ts';
import { ensureLearner } from './learners.ts';

const T = Date.parse('2026-11-16T00:00:00Z');

async function seeded() {
  const { userDb } = await setupDb();
  const learner = ensureLearner(userDb).id;
  const db = userDb.sqlite;
  const mastery = db.prepare(
    `INSERT INTO concept_mastery (learner_id, concept_id, score, stage, updated_at, engine_version)
     VALUES (?, ?, ?, 'practicing', ?, 'v')`,
  );
  mastery.run(learner, 'js.old.a', 40, T);
  mastery.run(learner, 'js.old.b', 70, T);
  mastery.run(learner, 'js.new.c', 10, T);
  db.prepare(
    `INSERT INTO lesson_progress (learner_id, lesson_id, status, updated_at) VALUES (?, ?, 'completed', ?)`,
  ).run(learner, 'js-basics.m.old-lesson', T);
  const attempt = db.prepare(
    `INSERT INTO attempts (id, learner_id, exercise_id, exercise_origin, variant_group_key,
       exercise_version_hash, attempt_no, attempt_in_item, outcome, score, started_at, submitted_at,
       active_ms, grading_json)
     VALUES (?, ?, ?, 'authored', ?, 'h', 1, 1, 'correct', 1, ?, ?, 1000, '{}')`,
  );
  attempt.run('a1', learner, 'js-basics.m.l.mcq-old', 'js-basics.m.l.mcq-old', T, T);
  attempt.run('a2', learner, 'js-basics.m.l.mcq-other', 'group-1', T, T);
  return { userDb, db, learner };
}

const aliases: ContentAlias[] = [
  {
    oldId: 'js.old.a',
    newId: 'js.new.a',
    aliasKind: 'rename',
    isPrimary: true,
    entityKind: 'concept',
  },
  // Merge into a concept that already has a row: the old row is kept as an orphan.
  {
    oldId: 'js.old.b',
    newId: 'js.new.c',
    aliasKind: 'merge',
    isPrimary: true,
    entityKind: 'concept',
  },
  {
    oldId: 'js-basics.m.old-lesson',
    newId: 'js-basics.m.part-1',
    aliasKind: 'split',
    isPrimary: true,
    entityKind: 'lesson',
  },
  {
    oldId: 'js-basics.m.old-lesson',
    newId: 'js-basics.m.part-2',
    aliasKind: 'split',
    isPrimary: false,
    entityKind: 'lesson',
  },
  {
    oldId: 'js-basics.m.l.mcq-old',
    newId: 'js-basics.m.l.mcq-new',
    aliasKind: 'rename',
    isPrimary: true,
    entityKind: 'exercise',
  },
];

const col = (db: Awaited<ReturnType<typeof seeded>>['db'], sql: string) =>
  (db.prepare(sql).all() as Record<string, unknown>[]).map((r) => Object.values(r).join(' '));

describe('resolveAliases', () => {
  it('moves records to the current slug, keeps conflicting rows, and leaves other rows alone', async () => {
    const { db } = await seeded();
    const result = resolveAliases(db, aliases);
    expect(col(db, 'SELECT concept_id, score FROM concept_mastery ORDER BY concept_id')).toEqual([
      'js.new.a 40',
      'js.new.c 10',
      'js.old.b 70',
    ]);
    expect(col(db, 'SELECT lesson_id FROM lesson_progress')).toEqual(['js-basics.m.part-1']);
    expect(col(db, 'SELECT id, exercise_id, variant_group_key FROM attempts ORDER BY id')).toEqual([
      'a1 js-basics.m.l.mcq-new js-basics.m.l.mcq-new',
      'a2 js-basics.m.l.mcq-other group-1',
    ]);
    expect(result.updated).toMatchObject({
      'concept_mastery.concept_id': 1,
      'lesson_progress.lesson_id': 1,
      'attempts.exercise_id': 1,
      'attempts.variant_group_key': 1,
    });
    expect(result.kept).toEqual({ 'concept_mastery.concept_id': 1 });
  });

  it('does not apply an alias to columns of another kind', async () => {
    const { db, learner } = await seeded();
    // A lesson-kind alias whose old slug happens to equal a concept id.
    resolveAliases(db, [
      {
        oldId: 'js.old.a',
        newId: 'js.x.y',
        aliasKind: 'rename',
        isPrimary: true,
        entityKind: 'lesson',
      },
    ]);
    expect(
      col(
        db,
        `SELECT concept_id FROM concept_mastery WHERE learner_id = '${learner}' AND concept_id = 'js.old.a'`,
      ),
    ).toEqual(['js.old.a']);
  });
});

describe('resolveContentAliases', () => {
  it('backs up before rewriting, records the alias set, and skips it next time', async () => {
    const { userDb } = await seeded();
    const backup = vi.fn(() => Promise.resolve('/backups/x'));
    const first = await resolveContentAliases(() => userDb.sqlite, aliases, backup);
    expect(first?.backupPath).toBe('/backups/x');
    expect(backup).toHaveBeenCalledTimes(1);
    const meta = userDb.sqlite
      .prepare('SELECT value FROM app_meta WHERE key = ?')
      .get(ALIASES_APPLIED_KEY) as { value: string };
    expect(meta.value).toBe(aliasFingerprint(aliases));
    // The kept orphan row would match again; the fingerprint keeps it from re-running (and
    // from taking a backup on every start).
    expect(await resolveContentAliases(() => userDb.sqlite, aliases, backup)).toBeNull();
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it('takes no backup when no record holds an old slug', async () => {
    const { userDb } = await setupDb();
    const backup = vi.fn(() => Promise.resolve('/backups/x'));
    expect(await resolveContentAliases(() => userDb.sqlite, aliases, backup)).toBeNull();
    expect(await resolveContentAliases(() => userDb.sqlite, [], backup)).toBeNull();
    expect(backup).not.toHaveBeenCalled();
  });
});

describe('ContentRepository.aliases', () => {
  it('reads content_id_aliases rows', () => {
    const path = writeContentDb();
    const raw = new Database(path);
    raw
      .prepare(
        `INSERT INTO content_id_aliases (old_id, new_id, alias_kind, is_primary, entity_kind, since_pack_version)
         VALUES ('js.old.a', 'js.new.a', 'rename', 1, 'concept', '2026.11.14.1')`,
      )
      .run();
    raw.close();
    const repo = new ContentRepository(path);
    expect(repo.aliases()).toEqual([
      {
        oldId: 'js.old.a',
        newId: 'js.new.a',
        aliasKind: 'rename',
        isPrimary: true,
        entityKind: 'concept',
      },
    ]);
    repo.close();
  });
});
