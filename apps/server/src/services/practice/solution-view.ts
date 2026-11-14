import {
  assembleParsons,
  parsonsReferenceAnswer,
  type FillBlankSpec,
  type FindBugLineSpec,
  type FixBugSpec,
  type ImplementFunctionSpec,
  type McqMultiSpec,
  type McqSingleSpec,
  type ParsonsSpec,
  type PredictOutputSpec,
  type TrueFalseSpec,
  type WebTaskSpec,
} from '@proginone/exercise-kit';
import { formatValue, type SolutionView } from '@proginone/shared';

/**
 * What "정답 보기" reveals for a validated spec (D-010: only after the third hint). exercise-kit
 * has no display helper for this, so the server picks the reference answer per type. Hidden
 * checks and misconception maps are never part of the view.
 */
export function solutionView(typeId: string, spec: unknown): SolutionView {
  switch (typeId) {
    case 'mcq_single': {
      const s = spec as McqSingleSpec;
      const option = s.options.find((o) => o.id === s.correct);
      return { kind: 'choice', choiceId: s.correct, text: option?.text ?? '' };
    }
    case 'mcq_multi': {
      const s = spec as McqMultiSpec;
      return {
        kind: 'choices',
        choices: s.options
          .filter((o) => s.correct.includes(o.id))
          .map((o) => ({ id: o.id, text: o.text })),
      };
    }
    case 'true_false': {
      const s = spec as TrueFalseSpec;
      const verdict = s.answer ? '참이에요.' : '거짓이에요.';
      const reason = s.requireReason ? s.reasons?.find((r) => r.correct)?.text : undefined;
      return { kind: 'text', text: reason ? `${verdict} 이유: ${reason}` : verdict };
    }
    case 'fill_blank': {
      const s = spec as FillBlankSpec;
      return {
        kind: 'blanks',
        blanks: s.blanks.map((b) => ({ id: b.id, answer: b.accept[0] ?? null })),
      };
    }
    case 'predict_output': {
      const expected = (spec as PredictOutputSpec).expected;
      const choices = (spec as PredictOutputSpec).choices ?? [];
      switch (expected?.kind) {
        case 'console':
          return { kind: 'console', lines: expected.lines };
        case 'value':
          return { kind: 'value', text: formatValue(expected.value) };
        case 'error':
          return { kind: 'error', thrown: expected.thrown, name: expected.name ?? null };
        case 'choice':
          return {
            kind: 'choice',
            choiceId: expected.choiceId,
            text: choices.find((c) => c.id === expected.choiceId)?.text ?? '',
          };
        default:
          return { kind: 'none' };
      }
    }
    case 'find_bug_line': {
      const s = spec as FindBugLineSpec;
      const cause = s.causeOptions?.find((c) => c.correct)?.text;
      const lines = `${s.bugLines.join(', ')}번 줄이에요.`;
      return { kind: 'text', text: cause ? `${lines} 이유: ${cause}` : lines };
    }
    case 'parsons': {
      const s = spec as ParsonsSpec;
      return {
        kind: 'files',
        files: [{ path: 'main.js', content: `${assembleParsons(s, parsonsReferenceAnswer(s))}\n` }],
      };
    }
    case 'implement_function':
      return { kind: 'files', files: filesOf((spec as ImplementFunctionSpec).solution.files) };
    case 'fix_bug':
      return { kind: 'files', files: filesOf((spec as FixBugSpec).solution.files) };
    case 'web_task':
      return { kind: 'files', files: filesOf((spec as WebTaskSpec).solution.files) };
    default:
      return { kind: 'none' };
  }
}

function filesOf(files: readonly { path: string; content: string }[]) {
  return files.map((f) => ({ path: f.path, content: f.content }));
}
