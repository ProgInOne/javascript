// Builds results/results.md (test × browser table) and results/evidence.json from the
// Playwright JSON report (results/run.raw.json).
import { readFileSync, writeFileSync } from 'node:fs';

const inputs = process.argv.slice(2).length ? process.argv.slice(2) : ['results/run.raw.json'];
const raws = inputs.map((f) => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8')));
const rows = new Map(); // title -> { project -> { status, evidence, error } }
const projects = new Set();

function walk(suite, prefix = []) {
  const titlePath = suite.title && !suite.title.endsWith('.mjs') ? [...prefix, suite.title] : prefix;
  for (const spec of suite.specs || []) {
    const title = [...titlePath, spec.title].join(' › ');
    for (const t of spec.tests) {
      const res = t.results[t.results.length - 1];
      if (!res) continue;
      projects.add(t.projectName);
      const ev = (t.annotations || res.annotations || []).filter((a) => a.type === 'evidence').map((a) => JSON.parse(a.description));
      const err = res.error ? String(res.error.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 3).join(' ') : undefined;
      if (!rows.has(title)) rows.set(title, {});
      rows.get(title)[t.projectName] = { status: res.status, durationMs: res.duration, evidence: ev.length === 1 ? ev[0] : ev, error: err };
    }
  }
  for (const s of suite.suites || []) walk(s, titlePath);
}
for (const raw of raws) for (const s of raw.suites) walk(s);

const order = ['chromium', 'chrome', 'firefox', 'webkit'].filter((p) => projects.has(p));
const icon = (s) => ({ passed: '✅', failed: '❌', timedOut: '⏱', skipped: '–', interrupted: '⚠' })[s] || s;
let md = `# Sandbox PoC results\n\nGenerated ${new Date().toISOString()} by tools/report.mjs from ${inputs.join(', ')}.\n` +
  `Recorded (observe-only) tests pass unless the harness itself broke; read their evidence in results/evidence.json.\n\n`;
md += `| Test | ${order.join(' | ')} |\n|---|${order.map(() => '---').join('|')}|\n`;
for (const [title, byProject] of rows) {
  md += `| ${title.replace(/\|/g, '\\|')} | ${order.map((p) => (byProject[p] ? icon(byProject[p].status) : '')).join(' | ')} |\n`;
}
const failures = [];
for (const [title, byProject] of rows) for (const p of order) if (byProject[p] && byProject[p].status !== 'passed') failures.push(`- **${title}** [${p}]: ${byProject[p].error || byProject[p].status}`);
if (failures.length) md += `\n## Failures\n\n${failures.join('\n')}\n`;
writeFileSync(new URL('../results/' + (process.env.PG_OUT || 'results') + '.md', import.meta.url), md);
writeFileSync(new URL('../results/' + (process.env.PG_OUT || 'results') + '.evidence.json', import.meta.url), JSON.stringify(Object.fromEntries(rows), null, 1));
console.log(md);
