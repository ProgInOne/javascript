/**
 * `@proginone/runner`: browser code execution sandbox (docs/design/code-execution-sandbox.md).
 *
 * - `@proginone/runner`: host API, protocol and prepare step (this entry). The host needs a
 *   browser; the rest also runs in Node.
 * - `@proginone/runner/protocol`: zod schemas only.
 * - `@proginone/runner/shell-build`: builds `/sandbox/runner.html` (Node, used by the server).
 */
export * from './protocol/index.ts';
export * from './prepare/index.ts';
export { createRunnerHost, type RunnerHost, type RunnerHostOptions } from './host/host.ts';
