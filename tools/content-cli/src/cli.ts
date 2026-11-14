#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkContent } from './check.ts';

const USAGE = `사용법: content-cli <명령> [옵션]

명령
  check    콘텐츠 스키마와 참조 무결성을 검사합니다

옵션
  --dir <경로>   콘텐츠 디렉터리 (기본: ./content)
  --strict       경고도 실패로 처리합니다`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: 'content' },
    strict: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command] = positionals;
if (values.help || !command) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

if (command === 'check') {
  const { diagnostics } = checkContent(resolve(values.dir));
  for (const d of diagnostics.items) {
    console.log(`${d.level === 'error' ? '오류' : '경고'}  ${d.file}  ${d.message}`);
  }
  console.log(`\n오류 ${diagnostics.errorCount}개, 경고 ${diagnostics.warningCount}개`);
  const failed = diagnostics.errorCount > 0 || (values.strict && diagnostics.warningCount > 0);
  process.exit(failed ? 1 : 0);
}

console.error(`알 수 없는 명령입니다: ${command}\n\n${USAGE}`);
process.exit(1);
