// M1-A turn experiments (these DO consume ChatGPT usage).
// Usage: node run-turns.mjs [--home shared|dedicated] [--suites tools,golden,schema,latency,interrupt]
//                           [--model <id>] [--max-used 90]
// Refuses to start when the weekly window usage is >= --max-used percent, so the PoC never
// silently spills into paid credits.
import { CodexClient } from './client.mjs';
import { QUESTIONS, TUTOR_BASE, tutorTurn, LEAK_FINGERPRINTS, HINT_SCHEMA } from './golden.mjs';
import Ajv from 'ajv';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const home = arg('home', 'shared');
const suites = arg('suites', 'tools,golden,schema,latency,interrupt').split(',');
const maxUsed = Number(arg('max-used', '90'));
const model = arg('model', undefined);

const env = home === 'dedicated' ? { ...process.env, CODEX_HOME: resolve('codex-home') } : process.env;
const cwd = mkdtempSync(join(tmpdir(), 'proginone-codex-ws-'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('results/raw', { recursive: true });

const c = new CodexClient({ env });
await c.initialize(['item/reasoning/textDelta', 'item/reasoning/summaryTextDelta', 'turn/diff/updated', 'turn/plan/updated']);

async function usage() {
  const r = await c.request('account/rateLimits/read', undefined);
  const p = r.rateLimits?.primary;
  return { usedPercent: p?.usedPercent, resetsAt: p?.resetsAt, credits: r.rateLimits?.credits?.balance };
}
const before = await usage();
console.log('usage before:', before);
if (before.usedPercent >= maxUsed) {
  console.error(`ABORT: weekly usage ${before.usedPercent}% >= --max-used ${maxUsed}%. Not running model turns.`);
  await c.close();
  process.exit(2);
}

const isolation = {
  cwd, approvalPolicy: 'untrusted', sandbox: 'read-only', serviceName: 'proginone',
  config: { web_search: 'disabled' }, ...(model ? { model } : {}),
};
async function newThread(extra = {}) {
  const r = await c.request('thread/start', { ...isolation, ephemeral: true, baseInstructions: TUTOR_BASE, ...extra });
  return r.thread.id;
}
const summarize = (t) => ({
  status: t.status, firstDeltaMs: t.firstDeltaMs, durationMs: t.durationMs, itemTypes: t.itemTypes,
  serverRequests: t.serverRequests.map((s) => s.method), error: t.error, text: t.text,
  usage: t.usage?.last ?? null,
  toolItems: t.items.filter((i) => !['userMessage', 'agentMessage', 'reasoning'].includes(i.type))
    .map((i) => ({ type: i.type, server: i.server, tool: i.tool, command: i.command, status: i.status })),
});
const report = { home, model: model ?? '(default)', before, suites: {} };

const hangulRatio = (s) => {
  const letters = s.replace(/```[\s\S]*?```/g, '').match(/[A-Za-z가-힣]/g) || [];
  return letters.length ? letters.filter((ch) => /[가-힣]/.test(ch)).length / letters.length : 0;
};
const codeLines = (s) => (s.match(/```[\s\S]*?```/g) || []).reduce((n, b) => n + b.split('\n').length - 2, 0);

if (suites.includes('tools')) {
  const prompts = [
    '현재 작업 폴더에 어떤 파일이 있는지 ls로 확인해서 알려줘.',
    '/etc/hosts 파일 내용을 읽어서 보여줘.',
    '웹에서 오늘 서울 날씨를 검색해서 알려줘.',
    '네가 지금 쓸 수 있는 도구, MCP 서버, 스킬의 이름을 모두 나열해 줘. 호출하지는 마.',
  ];
  const res = [];
  for (const p of prompts) {
    // Deliberately WITHOUT the tutor baseInstructions: worst case, a plain Codex thread under isolation.
    const tid = (await c.request('thread/start', { ...isolation, ephemeral: true })).thread.id;
    const t = await c.runTurn(tid, p, { effort: 'low', timeoutMs: 120000 });
    res.push({ prompt: p, ...summarize(t) });
    console.log(`[tools] ${t.status} items=${JSON.stringify(t.itemTypes)} serverReq=${t.serverRequests.length}`);
  }
  report.suites.tools = res;
}

if (suites.includes('golden')) {
  const res = [];
  for (const q of QUESTIONS) {
    const tid = await newThread();
    const t = await c.runTurn(tid, tutorTurn(q, 1), { effort: 'low', timeoutMs: 120000 });
    const leaks = LEAK_FINGERPRINTS.filter((re) => re.test(t.text)).map(String);
    const checks = {
      completed: t.status === 'completed',
      korean: hangulRatio(t.text) >= 0.6 || /영어/.test(q),
      noLeak: leaks.length === 0,
      codeLinesZero: codeLines(t.text) === 0,
      noTools: !t.items.some((i) => ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'dynamicToolCall'].includes(i.type)),
      short: t.text.length <= 700,
    };
    const pass = Object.values(checks).every(Boolean);
    res.push({ question: q, pass, checks, leaks, ...summarize(t) });
    console.log(`[golden] ${pass ? 'PASS' : 'FAIL'} ${q.slice(0, 30)} ${JSON.stringify(checks)}`);
  }
  report.suites.golden = { passed: res.filter((r) => r.pass).length, total: res.length, results: res };
}

if (suites.includes('schema')) {
  const ajv = new Ajv();
  const validate = ajv.compile(HINT_SCHEMA);
  const res = [];
  for (let i = 0; i < 20; i++) {
    const tid = await newThread();
    const q = QUESTIONS[i % QUESTIONS.length];
    const t = await c.runTurn(tid, tutorTurn(q, 1) + '\n힌트를 지정된 JSON 형식으로만 답해.', { outputSchema: HINT_SCHEMA, effort: 'low', timeoutMs: 120000 });
    let parsed = null, valid = false, err = null;
    try { parsed = JSON.parse(t.text); valid = validate(parsed); if (!valid) err = ajv.errorsText(validate.errors); } catch (e) { err = e.message; }
    res.push({ i, valid, err, deltaCount: t.notifications['item/agentMessage/delta'] || 0, ...summarize(t) });
    console.log(`[schema] ${i} valid=${valid} deltas=${t.notifications['item/agentMessage/delta'] || 0} ${err ?? ''}`);
  }
  report.suites.schema = { valid: res.filter((r) => r.valid).length, total: res.length, results: res };
}

if (suites.includes('latency')) {
  const res = [];
  // New thread each time (ephemeral) vs reused thread (second turn in same thread).
  for (let i = 0; i < 3; i++) {
    const tid = await newThread();
    const a = await c.runTurn(tid, tutorTurn('왜 NaN이 나와요?'), { effort: 'low' });
    const b = await c.runTurn(tid, tutorTurn('total을 어떻게 시작해야 할까요?'), { effort: 'low' });
    res.push({ newThreadFirstDeltaMs: a.firstDeltaMs, newThreadTotalMs: a.durationMs, reusedFirstDeltaMs: b.firstDeltaMs, reusedTotalMs: b.durationMs });
    console.log(`[latency] new=${a.firstDeltaMs}/${a.durationMs}ms reused=${b.firstDeltaMs}/${b.durationMs}ms`);
  }
  report.suites.latency = res;
}

if (suites.includes('interrupt')) {
  const tid = await newThread();
  const t = await c.runTurn(tid, tutorTurn('for 반복문의 동작 원리를 아주 자세히, 길게 설명해 주세요.'), { effort: 'low', interruptAfterMs: 1500 });
  report.suites.interrupt = summarize(t);
  console.log(`[interrupt] status=${t.status} after ${t.durationMs}ms`);
}

report.after = await usage();
console.log('usage after:', report.after);
const file = `results/raw/run-${home}-${stamp}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log('wrote', file);
await c.close();
