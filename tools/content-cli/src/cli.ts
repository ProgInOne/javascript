#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildContent } from './build.ts';
import { checkContent } from './check.ts';
import { Diagnostics } from './diagnostics.ts';
import { exerciseKit } from './kit.ts';
import { loadContent } from './load.ts';
import { renderReport } from './report.ts';
import { runCheck, type RunCheckItem } from './run-check.ts';
import { BrowserMissingError, startBrowserRunner } from './verify/browser.ts';

const USAGE = `사용법: content-cli <명령> [옵션]

명령
  check    콘텐츠 스키마와 참조 무결성을 검사합니다
           --run을 붙이면 헤드리스 Chromium에서 앱과 같은 러너로 실행 검증도 합니다
  build    검사 후 content.db를 만듭니다. --include-drafts 없이 빌드하면 공개 slug 목록
           (<dir>/.published-slugs.txt)도 갱신합니다
  report   단원별 문제 수·유형 구성비·난이도 분포 표와 수량 기준 위반 목록을 출력합니다
           (FR-EX-09, 검토용. 항상 종료 코드 0)

옵션
  --dir <경로>   콘텐츠 디렉터리 (기본: ./content)
  --run          check: 문제와 레슨 예제를 실제로 실행해 검증하고, 예측 문제의
                 기대값을 .generated/predict-expected.json에, 템플릿 표본 변형의
                 기대값을 .generated/template-expected.json에 기록합니다
  --frozen       check --run: 기대값 파일이 최신이 아니면 쓰지 않고 실패합니다(CI용)
  --concurrency <n>
                 check --run: 동시에 실행할 브라우저 페이지 수 (기본: 4)
  --out <경로>   build 결과 파일 (기본: ./content/dist/content.db)
  --strict       경고도 실패로 처리합니다
  --markdown     report: 표를 Markdown으로 출력합니다(PR 설명에 붙이기용)
  --include-drafts
                 build에 검토되지 않은(draft) 문제도 넣습니다. 개발 전용이며
                 배포용 content.db에는 쓰지 않습니다`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: 'content' },
    out: { type: 'string', default: 'content/dist/content.db' },
    strict: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    frozen: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
    'include-drafts': { type: 'boolean', default: false },
    markdown: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command] = positionals;
if (values.help || !command) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

function report(diagnostics: Diagnostics): boolean {
  for (const d of diagnostics.items) {
    console.log(`${d.level === 'error' ? '오류' : '경고'}  ${d.file}  ${d.message}`);
  }
  console.log(`\n오류 ${diagnostics.errorCount}개, 경고 ${diagnostics.warningCount}개`);
  return diagnostics.errorCount > 0 || (values.strict && diagnostics.warningCount > 0);
}

const STATUS_LABELS = { pass: '통과', fail: '실패', skip: '건너뜀' } as const;

function reportRun(items: readonly RunCheckItem[]): void {
  for (const item of items) {
    const { status, messages } = item.outcome;
    if (status === 'skip') continue;
    const name =
      item.kind === 'example'
        ? `예제 ${item.id.split('#')[1] ?? item.id}`
        : item.kind === 'template'
          ? `${item.type} 변형 @${item.id.split('@')[1] ?? ''}`
          : item.type;
    const [head, ...rest] = messages;
    console.log(`${STATUS_LABELS[status]}  ${item.file}  ${name}  ${head ?? ''}`);
    for (const line of rest) console.log(`      ${line}`);
  }
  const count = (s: string) => items.filter((i) => i.outcome.status === s).length;
  const examples = items.filter((i) => i.kind === 'example').length;
  const variants = items.filter((i) => i.kind === 'template').length;
  console.log(
    `\n실행 검증: 문제 ${items.length - examples - variants}개, 템플릿 변형 ${variants}개, 예제 ${examples}개 — 통과 ${count('pass')}, 실패 ${count('fail')}, 실행 대상 아님 ${count('skip')}`,
  );
}

async function checkWithRun(): Promise<boolean> {
  const concurrency = Number.parseInt(values.concurrency, 10);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error('--concurrency는 1 이상의 정수여야 합니다');
    return false;
  }
  let runner;
  try {
    runner = await startBrowserRunner({ concurrency });
  } catch (error) {
    if (error instanceof BrowserMissingError) {
      console.error(
        '오류  Chromium을 찾을 수 없습니다. 먼저 설치하세요:\n' +
          '      pnpm --filter @proginone/e2e exec playwright install chromium',
      );
      return false;
    }
    throw error;
  }
  const started = Date.now();
  try {
    const result = await runCheck(resolve(values.dir), {
      validateSpec: exerciseKit.validateSpec,
      runner,
      frozen: values.frozen,
      concurrency,
      quantity: true,
    });
    if (!result.ran) {
      console.log('스키마 검사에서 오류가 나서 실행 검증을 하지 않았습니다.\n');
      report(result.diagnostics);
      return false;
    }
    reportRun(result.items);
    for (const file of result.wrote) console.log(`기대값 파일을 갱신했습니다: ${file}`);
    console.log(`(${((Date.now() - started) / 1000).toFixed(1)}초)\n`);
    const failed = report(result.diagnostics);
    return result.ok && !failed;
  } finally {
    await runner.close();
  }
}

if (command === 'check' && values.run) {
  process.exit((await checkWithRun()) ? 0 : 1);
}

if (command === 'check') {
  const { diagnostics } = checkContent(resolve(values.dir), {
    validateSpec: exerciseKit.validateSpec,
    quantity: true,
  });
  process.exit(report(diagnostics) ? 1 : 0);
}

if (command === 'build') {
  const out = resolve(values.out);
  const includeDrafts = values['include-drafts'];
  if (includeDrafts) {
    console.warn(
      '경고  --include-drafts: 검토되지 않은(draft) 문제를 content.db에 포함합니다.\n' +
        '      개발용 빌드입니다. 배포·실사용 content.db는 이 옵션 없이 빌드하세요.\n',
    );
  }
  const result = buildContent(resolve(values.dir), out, {
    kit: exerciseKit,
    includeDrafts,
    quantity: true,
    updatePublishedSlugs: !includeDrafts,
  });
  const failed = report(result.diagnostics);
  if (result.written) {
    const s = result.stats;
    console.log(
      `content.db: ${out}\n과정 ${s.courses}, 단원 ${s.lessons}, 개념 ${s.concepts}, 문제 ${s.exercises}, 템플릿 ${s.templates}(검증된 변형 ${s.templateVariants}) (미검토 제외 ${s.skippedDrafts})`,
    );
    if (includeDrafts)
      console.warn(`경고  미검토(draft) 문제 ${s.includedDrafts}개가 포함된 개발용 빌드입니다.`);
  }
  process.exit(failed || !result.written ? 1 : 0);
}

if (command === 'report') {
  const diagnostics = new Diagnostics(resolve(values.dir));
  const source = loadContent(resolve(values.dir), diagnostics);
  if (diagnostics.errorCount > 0) {
    console.log('콘텐츠를 읽다가 오류가 났습니다. 먼저 content-cli check로 고치세요.\n');
    report(diagnostics);
    process.exit(1);
  }
  console.log(renderReport(source, values.markdown ? 'markdown' : 'text'));
  process.exit(0);
}

console.error(`알 수 없는 명령입니다: ${command}\n\n${USAGE}`);
process.exit(1);
