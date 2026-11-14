#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildContent } from './build.ts';
import { checkContent } from './check.ts';
import type { Diagnostics } from './diagnostics.ts';
import { exerciseKit } from './kit.ts';

const USAGE = `사용법: content-cli <명령> [옵션]

명령
  check    콘텐츠 스키마와 참조 무결성을 검사합니다
  build    검사 후 content.db를 만듭니다

옵션
  --dir <경로>   콘텐츠 디렉터리 (기본: ./content)
  --out <경로>   build 결과 파일 (기본: ./content/dist/content.db)
  --strict       경고도 실패로 처리합니다
  --include-drafts
                 build에 검토되지 않은(draft) 문제도 넣습니다. 개발 전용이며
                 배포용 content.db에는 쓰지 않습니다`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: 'content' },
    out: { type: 'string', default: 'content/dist/content.db' },
    strict: { type: 'boolean', default: false },
    'include-drafts': { type: 'boolean', default: false },
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

if (command === 'check') {
  const { diagnostics } = checkContent(resolve(values.dir), {
    validateSpec: exerciseKit.validateSpec,
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
  const result = buildContent(resolve(values.dir), out, { kit: exerciseKit, includeDrafts });
  const failed = report(result.diagnostics);
  if (result.written) {
    const s = result.stats;
    console.log(
      `content.db: ${out}\n과정 ${s.courses}, 단원 ${s.lessons}, 개념 ${s.concepts}, 문제 ${s.exercises} (미검토 제외 ${s.skippedDrafts})`,
    );
    if (includeDrafts)
      console.warn(`경고  미검토(draft) 문제 ${s.includedDrafts}개가 포함된 개발용 빌드입니다.`);
  }
  process.exit(failed || !result.written ? 1 : 0);
}

console.error(`알 수 없는 명령입니다: ${command}\n\n${USAGE}`);
process.exit(1);
