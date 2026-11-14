#!/usr/bin/env node
// Checks relative links and heading anchors in the repository's Markdown files.
// Usage: node tools/check-links.mjs [root]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.data',
  'codex-home',
  '.claude',
]);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return name.endsWith('.md') ? [p] : [];
  });
}

const stripCode = (text) => text.replace(/^```[\s\S]*?^```/gm, '');

/** GitHub-style heading slug, with -1, -2 suffixes for duplicates. */
const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const seen = new Map();
  const out = new Set();
  for (const line of stripCode(readFileSync(file, 'utf8')).split('\n')) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[2]
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
      .replace(/ /g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  anchorCache.set(file, out);
  return out;
}

const files = walk(root);
let bad = 0;
for (const file of files) {
  const text = stripCode(readFileSync(file, 'utf8')).replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue; // http:, mailto:, etc.
    const [path, anchor] = link.split('#');
    const target = !path
      ? file
      : path.startsWith('/')
        ? join(root, path)
        : normalize(join(dirname(file), decodeURI(path)));
    if (!existsSync(target)) {
      console.log(`MISSING  ${relative(root, file)} -> ${link}`);
      bad++;
      continue;
    }
    if (
      anchor &&
      target.endsWith('.md') &&
      !anchorsOf(target).has(decodeURIComponent(anchor).toLowerCase())
    ) {
      console.log(`ANCHOR   ${relative(root, file)} -> ${link}`);
      bad++;
    }
  }
}
console.log(`checked ${files.length} files, ${bad} broken link(s)`);
process.exit(bad ? 1 : 0);
