import { removeRunTempRoot, startRunTempRoot } from './test-tmp.ts';

/** Vitest global setup: every test's temporary folders go under one root, removed at the end. */
export default function setup(): () => void {
  const root = startRunTempRoot('vitest');
  return () => {
    if (root) removeRunTempRoot(root);
  };
}
