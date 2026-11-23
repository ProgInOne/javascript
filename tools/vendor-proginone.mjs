#!/usr/bin/env node
// Puts the registry @proginone/* packages into a release bundle so learners install it without a
// GitHub token (D-090: GitHub Packages needs a token even for public packages).
//
// Reads the exact versions from this checkout's install (`pnpm ls`), downloads each package with
// `npm pack` into <bundle>/vendor/, points <bundle>/pnpm-workspace.yaml `overrides` at those
// files and rewrites <bundle>/pnpm-lock.yaml. Workspace packages (`link:`) are left alone, so
// with no registry @proginone/* dependency this does nothing.
//
// Usage: node tools/vendor-proginone.mjs <bundle-dir>
//   Run from an installed checkout of the same commit. Needs a token with read:packages for
//   npm.pkg.github.com (CI: NODE_AUTH_TOKEN from setup-node; locally: ~/.npmrc).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REGISTRY = 'https://npm.pkg.github.com';
const bundle = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(bundle, 'pnpm-workspace.yaml'))) {
  console.error('Usage: node tools/vendor-proginone.mjs <bundle-dir with pnpm-workspace.yaml>');
  process.exit(2);
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

/** @type {{ dependencies?: Record<string, { version: string }> }[]} */
const projects = JSON.parse(run('pnpm', ['ls', '-r', '--json', '--depth', '0'], process.cwd()));
/** @type {Map<string, string>} */
const wanted = new Map();
for (const project of projects) {
  for (const [name, { version }] of Object.entries(project.dependencies ?? {})) {
    if (!name.startsWith('@proginone/') || version.startsWith('link:')) continue;
    const seen = wanted.get(name);
    if (seen !== undefined && seen !== version) {
      console.error(`${name}: workspace projects use different versions (${seen}, ${version})`);
      process.exit(1);
    }
    wanted.set(name, version);
  }
}

if (wanted.size === 0) {
  console.log('No registry @proginone/* dependencies; nothing to vendor.');
  process.exit(0);
}

const workspaceFile = join(bundle, 'pnpm-workspace.yaml');
if (/^overrides:/m.test(readFileSync(workspaceFile, 'utf8'))) {
  console.error('pnpm-workspace.yaml already has overrides; merge them by hand before vendoring.');
  process.exit(1);
}

const vendor = join(bundle, 'vendor');
mkdirSync(vendor, { recursive: true });
const lines = [
  '',
  '# Added by tools/vendor-proginone.mjs for the release bundle: @proginone/* comes from vendor/.',
  'overrides:',
];
for (const [name, version] of [...wanted].sort()) {
  const out = run(
    'npm',
    [
      'pack',
      `${name}@${version}`,
      '--pack-destination',
      vendor,
      '--json',
      `--@proginone:registry=${REGISTRY}`,
    ],
    bundle,
  );
  const [{ filename }] = JSON.parse(out);
  lines.push(`  '${name}': file:vendor/${filename}`);
  console.log(`vendored ${name}@${version} -> vendor/${filename}`);
}
appendFileSync(workspaceFile, `${lines.join('\n')}\n`);

// Re-resolve only what changed: the overridden packages now come from vendor/ (with integrity).
run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], bundle);
console.log('Rewrote pnpm-lock.yaml for the vendored packages.');
