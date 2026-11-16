#!/usr/bin/env node
// Initial-load bundle budget (D-064, docs/reviews/2026-11-16-m7-performance.md).
//
// Sums the gzip size of what `apps/web/dist/index.html` loads before the first screen: the entry
// script, its modulepreload chunks and the stylesheets. Byte counts are deterministic, unlike
// timings, so this runs in CI after `pnpm build` and catches a library landing in the first
// load (the cause of most first-screen regressions) without a flaky timing threshold.
//
//   pnpm check:bundle

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Budgets in KiB (gzip), ~15–25% above the 2026-11-16 build (JS 190, CSS 36: mostly the
 * Pretendard @font-face subsets). Raise only with a reason in the PR. */
const BUDGET_KIB = { js: 220, css: 45 };

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'dist');
let html;
try {
  html = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  console.error('apps/web/dist/index.html가 없습니다. 먼저 `pnpm build`를 실행하세요.');
  process.exit(1);
}

const refs = [
  ...html.matchAll(/<script[^>]*\bsrc="(\/assets\/[^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="(\/assets\/[^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"/g),
].map((m) => m[1]);

const files = [...new Set(refs)].map((ref) => {
  const bytes = readFileSync(join(dist, ref));
  return { ref, kind: ref.endsWith('.css') ? 'css' : 'js', gzip: gzipSync(bytes).length };
});

let failed = false;
for (const kind of /** @type {const} */ (['js', 'css'])) {
  const list = files.filter((f) => f.kind === kind).sort((a, b) => b.gzip - a.gzip);
  const total = list.reduce((sum, f) => sum + f.gzip, 0) / 1024;
  const ok = total <= BUDGET_KIB[kind];
  failed ||= !ok;
  console.log(
    `${ok ? '✓' : '✗'} 첫 화면 ${kind.toUpperCase()} ${total.toFixed(1)} KiB (gzip) / 예산 ${String(BUDGET_KIB[kind])} KiB, 파일 ${String(list.length)}개`,
  );
  if (!ok) {
    for (const f of list.slice(0, 5))
      console.log(`    ${(f.gzip / 1024).toFixed(1)} KiB  ${f.ref}`);
  }
}
if (failed) {
  console.error('첫 화면 번들이 예산을 넘었습니다. 무거운 모듈은 화면 단위로 지연 로드하세요.');
  process.exit(1);
}
