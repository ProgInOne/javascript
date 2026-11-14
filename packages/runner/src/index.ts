/**
 * `@proginone/runner`: browser code execution sandbox (docs/design/code-execution-sandbox.md).
 *
 * - `@proginone/runner`: protocol and prepare step (this entry; browser and Node).
 * - `@proginone/runner/protocol`: zod schemas only.
 * - `@proginone/runner/shell-build`: builds `/sandbox/runner.html` (Node, used by the server).
 */
export * from './protocol/index.ts';
export * from './prepare/index.ts';
