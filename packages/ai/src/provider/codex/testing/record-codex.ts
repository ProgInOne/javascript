// Records the Codex protocol contract fixtures (docs/design/ai-system.md#codex-프로토콜-계약-테스트).
// Manual tool, never run in CI:
//
//   node packages/ai/src/provider/codex/testing/record-codex.ts --home <logged-in tutor home> [--only <scenario>]
//
// `--home` is a Codex home that is already logged in (for example the M1-A PoC home). It is
// copied into a temporary data dir per scenario and never modified. Each scenario of
// scenarios.ts runs against the real `codex app-server` through tee-codex.mjs; the exchange is
// scrubbed (scrub.ts), checked for leaks and written to recordings/<codex version>/<name>.jsonl.
// Logged-in scenarios cost real model turns (see `modelCalls`).
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CodexAdapter } from '../adapter.ts';
import { findExecutable } from '../process.ts';
import { parseCodexVersion } from '../version.ts';
import { RECORDED_SCENARIOS } from './scenarios.ts';
import { findLeaks, scrubRecording, type RawLine } from './scrub.ts';

const { values } = parseArgs({
  options: {
    home: { type: 'string' },
    only: { type: 'string', multiple: true },
    codex: { type: 'string', default: 'codex' },
  },
});

const realCodex = findExecutable(values.codex, process.env['PATH']);
if (!realCodex) throw new Error(`codex not found: ${values.codex}`);
const version = parseCodexVersion(execFileSync(realCodex, ['--version'], { encoding: 'utf8' }));
if (!version) throw new Error('could not read the Codex version');
const tee = fileURLToPath(new URL('./tee-codex.mjs', import.meta.url));
const outDir = fileURLToPath(new URL(`./recordings/${version}/`, import.meta.url));
mkdirSync(outDir, { recursive: true });

const scenarios = RECORDED_SCENARIOS.filter((s) => !values.only || values.only.includes(s.name));
if (scenarios.some((s) => s.home === 'logged_in') && !values.home) {
  throw new Error('--home <logged-in Codex home> is required for logged-in scenarios');
}
const forbidden = [userInfo().username, hostname().split('.')[0] ?? ''];
const out = (text: string) => process.stdout.write(`${text}\n`);

for (const scenario of scenarios) {
  const tmp = mkdtempSync(join(tmpdir(), 'proginone-codex-rec-'));
  try {
    const dataDir = join(tmp, 'data');
    mkdirSync(dataDir, { recursive: true });
    if (scenario.home === 'logged_in' && values.home) {
      cpSync(values.home, join(dataDir, 'codex-home'), { recursive: true });
    }
    const rawPath = join(tmp, 'raw.jsonl');
    writeFileSync(rawPath, '');
    const adapter = new CodexAdapter({
      codexPath: tee,
      dataDir,
      env: { ...process.env, TEE_CODEX_REAL: realCodex, TEE_CODEX_RECORD: rawPath },
      clientVersion: '0.0.0-contract',
      log: (level, event, fields) => {
        if (level !== 'debug')
          process.stderr.write(`[${level}] ${event} ${JSON.stringify(fields ?? {})}\n`);
      },
    });
    const started = performance.now();
    let outcome;
    try {
      outcome = await scenario.run(adapter);
    } finally {
      await adapter.dispose();
    }
    const raw = readFileSync(rawPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as RawLine);
    const entries = scrubRecording(raw, {
      dataDirs: [dataDir, realpathSync(dataDir)],
      hidePaths: [homedir(), realpathSync(homedir()), tmpdir(), realpathSync(tmpdir())],
      hideWords: forbidden,
    });
    const meta = {
      meta: {
        scenario: scenario.name,
        codexVersion: version,
        recordedAt: new Date().toISOString().slice(0, 10),
        modelCalls: scenario.modelCalls,
      },
    };
    const text = [meta, ...entries].map((e) => JSON.stringify(e)).join('\n') + '\n';
    const leaks = findLeaks(text, { forbidden });
    if (leaks.length > 0) {
      // Keep the rejected file outside the repository for inspection (RECORD_DEBUG_DIR).
      const debugDir = process.env['RECORD_DEBUG_DIR'];
      if (debugDir) writeFileSync(join(debugDir, `${scenario.name}.rejected.jsonl`), text);
      throw new Error(`${scenario.name}: scrubbed recording still contains ${leaks.join(', ')}`);
    }
    writeFileSync(join(outDir, `${scenario.name}.jsonl`), text);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    out(`${scenario.name}: ${entries.length} messages, ${seconds}s, status ${outcome.status}`);
    for (const step of outcome.steps) {
      const { text: reply, deltaText: _d, partialText: _p, ...rest } = step;
      out(
        `  ${JSON.stringify({ ...rest, ...(typeof reply === 'string' ? { textChars: reply.length } : {}) })}`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
