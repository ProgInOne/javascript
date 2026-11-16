import type {
  CodeDraft,
  CodeDraftPut,
  CodeDraftPutResponse,
  CodeDraftResponse,
  ExampleDraftList,
} from '@proginone/shared';
import type { UserDb } from '../../db/user/connection.ts';
import {
  deleteCodeDraft,
  getCodeDraft,
  listCodeDraftsByPrefix,
  saveCodeDraft,
  type CodeDraftRow,
} from '../../db/user/code-drafts.ts';
import { AppError } from '../../http/errors.ts';
import type { ContentAccess } from '../curriculum/content-access.ts';
import { learnerContext } from './engine.ts';

/** Exercise types whose answer is editor files (`{ files }`). */
const CODE_EXERCISE_TYPES = new Set(['implement_function', 'fix_bug', 'web_task']);

const exampleRef = (lessonId: string, exampleId: string) => `${lessonId}#${exampleId}`;

function view(row: CodeDraftRow): CodeDraft {
  return {
    kind: row.kind,
    id: row.kind === 'example' ? row.refId.slice(row.refId.indexOf('#') + 1) : row.refId,
    files: row.files,
    updatedAt: row.updatedAt,
    practiceSetItemId: row.practiceSetItemId,
  };
}

/**
 * Server-side code drafts (FR-CODE-06, NFR-04; data-model.md#code_drafts). The browser saves
 * every edit locally at once and here with a 2-second debounce. A draft stays after submission
 * (submissions keep the history), is learning data for a reset (D-045 keep-list) and is part of
 * every backup (the whole user.db). The code is stored as text and never run on the server.
 */
export class CodeDraftService {
  readonly #userDb: UserDb;
  readonly #content: ContentAccess;

  constructor(deps: { userDb: UserDb; content: ContentAccess }) {
    this.#userDb = deps.userDb;
    this.#content = deps.content;
  }

  #codeExercise(exerciseId: string): void {
    const exercise = this.#content.repo.getExercise(exerciseId);
    if (!exercise) {
      throw new AppError('NOT_FOUND', 404, '문제를 찾을 수 없습니다.', {
        details: { id: exerciseId },
      });
    }
    if (!CODE_EXERCISE_TYPES.has(exercise.type)) {
      throw new AppError('VALIDATION_FAILED', 400, '코드를 작성하는 문제가 아닙니다.', {
        details: { id: exerciseId, type: exercise.type },
      });
    }
  }

  #example(lessonId: string, exampleId?: string): void {
    const ids = this.#content.repo.lessonEditableExampleIds(lessonId);
    if (ids === null) {
      throw new AppError('NOT_FOUND', 404, '단원을 찾을 수 없습니다.', {
        details: { id: lessonId },
      });
    }
    if (exampleId !== undefined && !ids.has(exampleId)) {
      throw new AppError('NOT_FOUND', 404, '수정할 수 있는 예제를 찾을 수 없습니다.', {
        details: { lessonId, exampleId },
      });
    }
  }

  getExercise(exerciseId: string): CodeDraftResponse {
    this.#codeExercise(exerciseId);
    const { learnerId } = learnerContext(this.#userDb);
    const row = getCodeDraft(this.#userDb.orm, learnerId, 'exercise', exerciseId);
    return { draft: row && view(row) };
  }

  putExercise(exerciseId: string, request: CodeDraftPut): CodeDraftPutResponse {
    this.#codeExercise(exerciseId);
    return this.#save({
      kind: 'exercise',
      refId: exerciseId,
      files: request.files,
      practiceSetItemId: request.practiceSetItemId ?? null,
      updatedAt: request.updatedAt,
    });
  }

  deleteExercise(exerciseId: string): void {
    this.#codeExercise(exerciseId);
    const { learnerId } = learnerContext(this.#userDb);
    deleteCodeDraft(this.#userDb.orm, learnerId, 'exercise', exerciseId);
  }

  listExamples(lessonId: string): ExampleDraftList {
    this.#example(lessonId);
    const { learnerId } = learnerContext(this.#userDb);
    const rows = listCodeDraftsByPrefix(this.#userDb.orm, learnerId, 'example', `${lessonId}#`);
    return { drafts: rows.map(view) };
  }

  putExample(lessonId: string, exampleId: string, request: CodeDraftPut): CodeDraftPutResponse {
    this.#example(lessonId, exampleId);
    if (request.practiceSetItemId) {
      throw new AppError('VALIDATION_FAILED', 400, '예제 초안에는 연습 항목이 없습니다.');
    }
    return this.#save({
      kind: 'example',
      refId: exampleRef(lessonId, exampleId),
      files: request.files,
      practiceSetItemId: null,
      updatedAt: request.updatedAt,
    });
  }

  deleteExample(lessonId: string, exampleId: string): void {
    this.#example(lessonId);
    const { learnerId } = learnerContext(this.#userDb);
    deleteCodeDraft(this.#userDb.orm, learnerId, 'example', exampleRef(lessonId, exampleId));
  }

  #save(row: CodeDraftRow): CodeDraftPutResponse {
    const orm = this.#userDb.orm;
    const { learnerId } = learnerContext(this.#userDb);
    const applied = saveCodeDraft(orm, learnerId, row);
    const stored = getCodeDraft(orm, learnerId, row.kind, row.refId);
    if (!stored) throw new Error('code draft vanished after save');
    return { draft: view(stored), applied };
  }
}
