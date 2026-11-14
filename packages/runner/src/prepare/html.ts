import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import type { PreparedScript } from '../protocol/messages.ts';
import { type Insertion, instrumentJs, type LearnerSyntaxError } from './instrument.ts';

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/** Where a prepared script's first character sits in the original file. */
export interface SourceInfo {
  file: string;
  /** 1-based line of the script's first character. */
  line: number;
  /** 0-based column of the script's first character. */
  column: number;
  insertions: Insertion[];
}

export interface HtmlSyntaxError extends LearnerSyntaxError {
  file: string;
}

export type PrepareHtmlResult =
  | {
      ok: true;
      /** Rewritten document. The shell inserts the harness at `harnessAt`. */
      document: string;
      harnessAt: number;
      /** Instrumented inline script bodies, delivered by the harness as `blob:` scripts. */
      scripts: PreparedScript[];
      /** Indexed by source id: inline scripts and instrumented `on*` handlers. */
      sources: SourceInfo[];
    }
  | { ok: false; errors: HtmlSyntaxError[] };

const JS_TYPES = new Set([
  '',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
]);

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const isElement = (n: unknown): n is Element =>
  typeof n === 'object' && n !== null && 'tagName' in n && 'attrs' in n;

/**
 * DOM mode rewrite (docs/design/code-execution-sandbox.md#dom--preview-모드-실행-순서).
 *
 * Edits the original text by parse5 source offsets instead of re-serializing, so the document the
 * learner wrote stays byte-for-byte the same apart from:
 * - each classic inline script body becomes `__pg.w(i)` padded with the same number of newlines;
 * - each `on*` attribute value is instrumented in place;
 * - `expose`, when given, is appended as a final inline script.
 *
 * `<script src>` and `<link href>` stay as they are; the shell CSP blocks them (single-document
 * exercises only in v0.1).
 */
export function prepareHtml(
  html: string,
  { file, expose }: { file: string; expose: string | null },
): PrepareHtmlResult {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const edits: { start: number; end: number; text: string }[] = [];
  const scripts: PreparedScript[] = [];
  const sources: SourceInfo[] = [];
  const errors: HtmlSyntaxError[] = [];

  const at = (line: number, col1: number, err: LearnerSyntaxError): HtmlSyntaxError => ({
    file,
    message: err.message,
    line: line + err.line - 1,
    column: err.line === 1 ? col1 - 1 + err.column : err.column,
  });

  const visitScript = (el: Element) => {
    const loc = el.sourceCodeLocation;
    const attrs = new Map(el.attrs.map((a) => [a.name, a.value]));
    if (!loc?.startTag || attrs.has('src')) return;
    const type = (attrs.get('type') ?? '').trim().toLowerCase();
    if (type === 'module') {
      errors.push({
        file,
        message: 'type="module" 스크립트는 아직 실행할 수 없습니다.',
        line: loc.startLine,
        column: loc.startCol,
      });
      return;
    }
    if (!JS_TYPES.has(type)) return; // data blocks and templates never run
    const start = loc.startTag.endOffset;
    const end = loc.endTag?.startOffset ?? loc.endOffset;
    const body = html.slice(start, end);
    const id = sources.length;
    const result = instrumentJs(body, { sourceId: id });
    if (!result.ok) {
      errors.push(at(loc.startTag.endLine, loc.startTag.endCol, result.error));
      return;
    }
    const i = scripts.length;
    scripts.push({ id, code: result.code });
    sources.push({
      file,
      line: loc.startTag.endLine,
      column: loc.startTag.endCol - 1,
      insertions: result.insertions,
    });
    const newlines = body.match(/\r\n|\r|\n|\u2028|\u2029/g)?.length ?? 0;
    edits.push({ start, end, text: `__pg.w(${i})${'\n'.repeat(newlines)}` });
  };

  const visitHandlers = (el: Element) => {
    const attrLocs = el.sourceCodeLocation?.attrs;
    if (!attrLocs) return;
    for (const attr of el.attrs) {
      if (!/^on[a-z]+$/i.test(attr.name)) continue;
      const loc = attrLocs[attr.name];
      if (!loc) continue;
      const id = sources.length;
      const result = instrumentJs(attr.value, { sourceId: id, handler: true });
      if (!result.ok) {
        errors.push({
          file,
          message: result.error.message,
          line: loc.startLine,
          column: loc.startCol,
        });
        continue;
      }
      if (result.loops > 0) {
        // The value starts after `name=` and an optional quote. Entities may shift columns a
        // little; loop positions only need the right line.
        const raw = html.slice(loc.startOffset, loc.endOffset);
        const valueAt = /^[^=]*=\s*["']?/.exec(raw)?.[0] ?? '';
        const before = valueAt.split(/\r\n|\r|\n/);
        const lastLine = before.at(-1) ?? '';
        sources.push({
          file,
          line: loc.startLine + before.length - 1,
          column: before.length === 1 ? loc.startCol - 1 + lastLine.length : lastLine.length,
          insertions: result.insertions,
        });
        edits.push({
          start: loc.startOffset,
          end: loc.endOffset,
          text: `${attr.name}="${escapeAttr(result.code)}"`,
        });
      }
    }
  };

  const walk = (node: ParentNode) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      visitHandlers(child);
      if (child.tagName === 'script') visitScript(child);
      // <template> content never runs on its own; scripts cloned out of it are not supported.
      if (child.tagName !== 'template') walk(child);
    }
  };
  walk(doc);

  if (errors.length > 0) return { ok: false, errors };

  edits.sort((a, b) => b.start - a.start);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (expose) out += `<script>${expose}</script>`;

  // The harness goes right after the doctype on the same line: no extra line, no quirks mode.
  // Edits never touch text before the doctype ends, so its offset is still valid.
  const doctype = doc.childNodes.find((n) => n.nodeName === '#documentType');
  const harnessAt = doctype?.sourceCodeLocation?.endOffset ?? 0;
  return { ok: true, document: out, harnessAt, scripts, sources };
}
