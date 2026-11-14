// "Prepare" step (in production this runs in a Prepare Worker; in the PoC it runs on the app thread).
// - Loop-guard instrumentation with acorn (no new lines inserted, so line numbers are preserved).
// - Expose script generation for let/const access without eval.
// - DOM mode: text-level rewrite of inline <script> bodies and on* attributes.
//   Production uses parse5 with source locations; this tokenizer is a PoC approximation.
import * as acorn from '/vendor/acorn.mjs';

const LOOP_TYPES = new Set([
  'ForStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
]);

let loopSeq = 0;

export function instrumentJs(code, { handler = false } = {}) {
  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: handler,
      allowAwaitOutsideFunction: false,
    });
  } catch (e) {
    return {
      code,
      syntaxError: { name: 'SyntaxError', message: e.message, line: e.loc?.line, column: e.loc?.column },
      loops: [],
    };
  }
  const edits = []; // { pos, text, seq }
  const loops = [];
  let seq = 0;
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    node.__parent = parent;
    if (LOOP_TYPES.has(node.type)) {
      const id = ++loopSeq;
      const { line, column } = node.loc.start;
      loops.push({ id, line, column });
      let target = node;
      while (target.__parent && target.__parent.type === 'LabeledStatement') target = target.__parent;
      const s = seq++;
      edits.push({ pos: target.start, text: `{let __pgL${id}=__pg.enter(${id},${line},${column});`, seq: s });
      edits.push({ pos: target.end, text: '}', seq: s });
      const body = node.body;
      if (body.type === 'BlockStatement') {
        edits.push({ pos: body.start + 1, text: `__pg.tick(__pgL${id});`, seq: s });
      } else {
        edits.push({ pos: body.start, text: `{__pg.tick(__pgL${id});`, seq: s });
        edits.push({ pos: body.end, text: '}', seq: s });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === '__parent' || key === 'loc') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => visit(c, node));
      else if (v && typeof v.type === 'string') visit(v, node);
    }
  };
  visit(ast, null);
  // Apply from the end. At equal positions apply inner (higher seq) first so outer text ends up first.
  edits.sort((a, b) => b.pos - a.pos || b.seq - a.seq);
  let out = code;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  return { code: out, loops };
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function exposeScript(names = []) {
  const parts = names
    .filter((n) => IDENT.test(n))
    .map(
      (n) =>
        `try{o[${JSON.stringify(n)}]=typeof ${n}==="undefined"?__pg.MISSING:${n};}catch(e){o[${JSON.stringify(n)}]=__pg.TDZ;}`,
    );
  return `__pg.expose((function(){var o={};${parts.join('')}return o;})());`;
}

// DOM mode: rewrite inline scripts and on* attributes in place (line-preserving).
export function prepareHtml(html, { instrument = true, expose = [], scriptDelivery = 'inline' } = {}) {
  const syntaxErrors = [];
  const loops = [];
  const scripts = [];
  let out = '';
  let i = 0;
  const lower = html.toLowerCase();
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end === -1 ? html.length : end + 3;
      out += html.slice(lt, stop);
      i = stop;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    let tag = html.slice(lt, gt + 1);
    if (instrument && /^<[a-z]/i.test(tag)) {
      tag = tag.replace(/\s(on[a-z]+)="([^"]*)"/gi, (m, attr, val) => {
        const decoded = val.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const r = instrumentJs(decoded, { handler: true });
        loops.push(...r.loops);
        return ` ${attr}="${r.code.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
      });
    }
    out += tag;
    i = gt + 1;
    if (/^<script[\s>]/i.test(tag) && !/\ssrc\s*=/i.test(tag)) {
      const close = lower.indexOf('</script', i);
      const stop = close === -1 ? html.length : close;
      const body = html.slice(i, stop);
      let code = body;
      if (instrument) {
        const r = instrumentJs(body);
        if (r.syntaxError) syntaxErrors.push(r.syntaxError);
        loops.push(...r.loops);
        code = r.code;
      }
      if (scriptDelivery === 'blob') {
        // Same-document blob script written at the same parser position (keeps order and
        // DOMContentLoaded semantics; errors are not muted in WebKit; lines are script-relative).
        scripts.push(code);
        out += `__pg.w(${scripts.length - 1})`;
      } else {
        out += code;
      }
      i = stop;
    }
  }
  // Harness marker on the doctype line (no new line, no quirks mode).
  const dt = /^\s*<!doctype[^>]*>/i.exec(out);
  if (dt) out = out.slice(0, dt[0].length) + '<!--PG_HARNESS-->' + out.slice(dt[0].length);
  else out = '<!--PG_HARNESS-->' + out;
  out += `<script>${exposeScript(expose)}</script>`;
  return { html: out, syntaxErrors, loops, scripts };
}
