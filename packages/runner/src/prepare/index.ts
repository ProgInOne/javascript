import type { RunError, SourcePosition } from '@proginone/run-contract';
import type { PreparedScript, RunPlan, RunRequest } from '../protocol/messages.ts';
import { ArgsExprError, exposeScript } from './expose.ts';
import { type CheckSource, prepareHtml, type SourceInfo } from './html.ts';
import { instrumentJs, originalColumn, syntaxCheckScript } from './instrument.ts';

export { ArgsExprError, exposedNames, exposeScript } from './expose.ts';
export { type CheckSource, prepareHtml, type SourceInfo } from './html.ts';
export {
  instrumentJs,
  originalColumn,
  STRICT_PREFIX,
  syntaxCheckScript,
  type Insertion,
} from './instrument.ts';

/** The code part of a `RunRequest` plus what the host needs to map positions back. */
export interface PreparedRun {
  code: Pick<RunRequest, 'scripts' | 'expose' | 'document' | 'harnessAt'>;
  sources: SourceInfo[];
}

/**
 * Engine syntax check (D-030): a `dom` run that only parses the learner scripts the prepare step
 * could not parse, so that learners see the browser's own `SyntaxError` message and position
 * instead of the pre-parser's wording. No learner code runs (see {@link syntaxCheckScript}).
 */
export interface SyntaxCheck {
  code: Pick<RunRequest, 'scripts' | 'document' | 'harnessAt'>;
  /** Indexed by check script id. */
  sources: SourceInfo[];
  /** Indexed by check script id: which prepare error the engine's error replaces. */
  targets: { errorIndex: number; lines: number }[];
}

export type PrepareOutcome =
  | { ok: true; prepared: PreparedRun }
  /**
   * `errors` carry the pre-parser's wording and positions. With `syntaxCheck`, the host runs it
   * and replaces them with the engine's ({@link nativeSyntaxErrors}); they stay as the fallback.
   */
  | { ok: false; errors: RunError[]; syntaxCheck?: SyntaxCheck };

/** The check document: one parser-inserted blob script per check script (blob delivery). */
const CHECK_DOCTYPE = '<!doctype html>';

function buildSyntaxCheck(
  items: { source: CheckSource; file: string; errorIndex: number }[],
): SyntaxCheck | undefined {
  if (items.length === 0) return undefined;
  const scripts: PreparedScript[] = [];
  const sources: SourceInfo[] = [];
  const targets: SyntaxCheck['targets'] = [];
  let document = CHECK_DOCTYPE;
  for (const { source, file, errorIndex } of items) {
    const id = sources.length;
    const s = syntaxCheckScript(source.code, { handler: source.handler, strict: true });
    scripts.push({ id, code: s.code });
    document += `<script>__pg.w(${id})</script>`;
    sources.push({ file, line: source.line, column: source.column, insertions: s.insertions });
    targets.push({ errorIndex, lines: s.lines });
  }
  return { code: { scripts, document, harnessAt: CHECK_DOCTYPE.length }, sources, targets };
}

/**
 * Replaces the prepare step's syntax errors with the ones the engine reported in the syntax
 * check run, mapped to learner files. An error the engine did not report (the check timed out,
 * or the engine accepted the code) keeps the pre-parser's message and position.
 */
export function nativeSyntaxErrors(
  errors: readonly RunError[],
  check: SyntaxCheck,
  result: { errors: readonly RunError[] },
): RunError[] {
  const out = [...errors];
  check.targets.forEach((target, id) => {
    const info = check.sources[id];
    const native = result.errors.find(
      (e) => e.name === 'SyntaxError' && e.position?.file === `src:${id}`,
    );
    if (!info || !native?.position) return;
    let pos: SourcePosition = native.position;
    if (pos.line > target.lines) {
      // Reported in the closing text of a handler wrapper: the end of the learner's code.
      pos = { file: pos.file, line: target.lines };
    } else if (pos.column !== undefined && pos.column < 1) {
      pos = { file: pos.file, line: pos.line }; // WebKit reports no column
    }
    out[target.errorIndex] = {
      phase: 'syntax',
      name: 'SyntaxError',
      message: native.message,
      position: mapPosition(pos, check.sources, info.file),
    };
  });
  return out;
}

/** The plan's entry file. */
export function entryFile(plan: RunPlan) {
  return plan.files.find((f) => f.path === plan.entry);
}

/** js-console run order: the entry first, then the other JS files in plan order. */
export function jsRunOrder(plan: RunPlan) {
  const js = plan.files.filter((f) => f.language === 'js');
  return [...js.filter((f) => f.path === plan.entry), ...js.filter((f) => f.path !== plan.entry)];
}

/**
 * Prepare step (docs/design/code-execution-sandbox.md#js-console-모드-실행-순서): parses and
 * instruments learner code without running it. Syntax errors end the run here, before any code
 * runs, with exact positions; the host then asks the engine for its own wording (D-030,
 * {@link SyntaxCheck}).
 *
 * v0.1 runs this on the app's main thread; the design's Prepare Worker comes with the editor.
 */
export function prepareRun(plan: RunPlan): PrepareOutcome {
  let expose: string | null;
  try {
    expose = exposeScript(plan.checks);
  } catch (e) {
    if (!(e instanceof ArgsExprError)) throw e;
    return {
      ok: false,
      errors: [
        {
          phase: 'harness',
          name: 'ArgsExprError',
          message: `${e.stepId}: ${e.message}`,
        },
      ],
    };
  }
  const syntax = (file: string, message: string, line: number, column: number): RunError => ({
    phase: 'syntax',
    name: 'SyntaxError',
    message,
    position: { file, line, column },
  });

  if (plan.mode === 'js-console') {
    const errors: RunError[] = [];
    const checks: Parameters<typeof buildSyntaxCheck>[0] = [];
    const scripts: PreparedScript[] = [];
    const sources: SourceInfo[] = [];
    for (const f of jsRunOrder(plan)) {
      const id = sources.length;
      const r = instrumentJs(f.content, { sourceId: id, strict: true });
      sources.push({ file: f.path, line: 1, column: 0, insertions: r.ok ? r.insertions : [] });
      if (!r.ok) {
        checks.push({
          source: { code: f.content, handler: false, line: 1, column: 0 },
          file: f.path,
          errorIndex: errors.length,
        });
        errors.push(syntax(f.path, r.error.message, r.error.line, r.error.column));
        continue;
      }
      scripts.push({ id, code: r.code });
    }
    if (errors.length > 0) return withCheck(errors, buildSyntaxCheck(checks));
    return { ok: true, prepared: { code: { scripts, expose }, sources } };
  }

  const entry = entryFile(plan);
  if (!entry) {
    return { ok: false, errors: [syntax('', 'HTML 파일이 없습니다.', 1, 1)] };
  }
  const r = prepareHtml(entry.content, { file: entry.path, expose });
  if (!r.ok) {
    const checks: Parameters<typeof buildSyntaxCheck>[0] = [];
    r.errors.forEach((e, errorIndex) => {
      if (e.check) checks.push({ source: e.check, file: e.file, errorIndex });
    });
    return withCheck(
      r.errors.map((e) => syntax(e.file, e.message, e.line, e.column)),
      buildSyntaxCheck(checks),
    );
  }
  return {
    ok: true,
    prepared: {
      code: { scripts: r.scripts, expose, document: r.document, harnessAt: r.harnessAt },
      sources: r.sources,
    },
  };
}

function withCheck(errors: RunError[], syntaxCheck: SyntaxCheck | undefined): PrepareOutcome {
  return syntaxCheck ? { ok: false, errors, syntaxCheck } : { ok: false, errors };
}

const SOURCE_ID = /^(src|orig):(\d+)$/;

/**
 * Maps a position the harness reported to the learner's file:
 * - `src:<id>`: line/column in the instrumented script (columns are shifted by guards);
 * - `orig:<id>`: line/column in the original script (loop guards report these).
 * Positions in other files (e.g. inline handlers reported against the document) are attributed to
 * `fallbackFile` with the line kept and the column dropped.
 */
export function mapPosition(
  pos: SourcePosition,
  sources: readonly SourceInfo[],
  fallbackFile: string,
): SourcePosition {
  const m = SOURCE_ID.exec(pos.file);
  const info = m ? sources[Number(m[2])] : undefined;
  if (!m || !info) return { file: fallbackFile, line: pos.line };
  const line = info.line + pos.line - 1;
  if (pos.column === undefined) return { file: info.file, line };
  const col = m[1] === 'src' ? originalColumn(info.insertions, pos.line, pos.column) : pos.column;
  return { file: info.file, line, column: pos.line === 1 ? info.column + col : col };
}

/** Applies {@link mapPosition} to every error position and stack frame. */
export function mapErrors(
  errors: readonly RunError[],
  sources: readonly SourceInfo[],
  fallbackFile: string,
): RunError[] {
  return errors.map((e) => {
    const out: RunError = { ...e };
    if (e.position) out.position = mapPosition(e.position, sources, fallbackFile);
    if (e.stack) out.stack = e.stack.map((p) => mapPosition(p, sources, fallbackFile));
    return out;
  });
}
