/**
 * `@proginone/runner`: browser code execution sandbox (docs/design/code-execution-sandbox.md).
 *
 * - `@proginone/runner`: host API and protocol (this entry). The host needs a browser; the rest
 *   also runs in Node. The host loads the prepare step on first use (D-074).
 * - `@proginone/runner/prepare`: the prepare step (parse5, acorn) on its own.
 * - `@proginone/runner/protocol`: zod schemas only.
 * - `@proginone/runner/shell-build`: builds `/sandbox/runner.html` (Node, used by the server).
 */
export * from './protocol/index.ts';
export {
  createRunnerHost,
  preloadRunner,
  type RunnerHost,
  type RunnerHostOptions,
} from './host/host.ts';
