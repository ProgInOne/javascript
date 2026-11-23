import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Code display rules (ui-ux.md 타이포그래피): no ligatures anywhere code is shown, and inline
 * code keeps its spaces. jsdom (and Vitest, which stubs CSS) does not apply cascade layers or the `font` shorthand reset, so
 * these are checked on the stylesheets themselves.
 */

const root = join(import.meta.dirname, '..');
const appCss = join(root, 'apps/web/src/app');
// @proginone/ui and @proginone/exercise-ui are published packages (ProgInOne/core); read the
// sheets the web app installs.
const fromWeb = createRequire(join(root, 'apps/web/package.json'));
const uiSheets = [
  '@proginone/ui/components.css',
  '@proginone/ui/base.css',
  '@proginone/exercise-ui/exercise-ui.css',
].map((specifier) => relative(root, fromWeb.resolve(specifier)));
const sheets: Record<string, string> = Object.fromEntries(
  [
    ...readdirSync(appCss)
      .filter((f) => f.endsWith('.css'))
      .map((f) => join('apps/web/src/app', f)),
    'packages/exercise-kit-ui/src/styles/exercise-kit-ui.css',
    ...uiSheets,
  ].map((file) => [file, readFileSync(join(root, file), 'utf8')]),
);

interface Rule {
  file: string;
  selector: string;
  body: string;
}

/** Innermost `selector { declarations }` blocks (good enough for these hand-written sheets). */
function rules(file: string, source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    file,
    selector: (m[1] ?? '').trim(),
    body: m[2] ?? '',
  }));
}

const all = Object.entries(sheets).flatMap(([file, source]) => rules(file, source));
const usesCodeFont = (r: Rule) =>
  /(^|[\s;])font:\s*var\(--text-code\)/.test(r.body) ||
  /font-family:\s*var\(--font-mono\)/.test(r.body);

describe('code font stylesheets', () => {
  it('finds the code font rules', () => {
    expect(all.filter(usesCodeFont).length).toBeGreaterThan(10);
  });

  it('turns ligatures off in every rule that sets the code font', () => {
    // A `font:` shorthand resets font-variant-ligatures, so each rule must switch them off again.
    const missing = all
      .filter(usesCodeFont)
      .filter(
        (r) =>
          !/font-variant-ligatures:\s*none/.test(r.body) &&
          // base.css sets the family and the ligature switches in two adjacent rules.
          !all.some(
            (o) =>
              o.file === r.file &&
              o.selector.includes(r.selector) &&
              /font-variant-ligatures:\s*none/.test(o.body),
          ),
      )
      .map((r) => `${r.file}: ${r.selector}`);
    expect(missing).toEqual([]);
    const withoutFeatures = all
      .filter((r) => /font-variant-ligatures:\s*none/.test(r.body))
      .filter((r) => !/font-feature-settings:\s*'liga' 0,\s*'calt' 0/.test(r.body))
      .map((r) => `${r.file}: ${r.selector}`);
    expect(withoutFeatures).toEqual([]);
  });

  it('keeps spaces in inline code and still wraps long tokens', () => {
    for (const selector of ['.pi-ex-inline-code', '.lesson-inline-code']) {
      const rule = all.find((r) => r.selector === selector);
      expect(rule, selector).toBeDefined();
      expect(rule?.body).toMatch(/white-space:\s*break-spaces/);
      expect(rule?.body).toMatch(/overflow-wrap:\s*anywhere/);
    }
  });
});
