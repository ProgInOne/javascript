import { describe, expect, it } from 'vitest';
import { buildHarness, runnerHtml, SHELL_CSP } from './build.ts';

describe('runner shell build', () => {
  it('builds a self-contained document with one inline script', async () => {
    const html = await runnerHtml();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // The bundle mentions `<script>` in strings, but only one script element can close.
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    const head = html.slice(0, html.indexOf('<script>'));
    expect(head).not.toMatch(/<script|<link/i);
    expect(html.endsWith('</script></body></html>')).toBe(true);
    // Cached: the same promise result.
    expect(await runnerHtml()).toBe(html);
  });

  it('keeps the harness on one line and free of zod', async () => {
    const harness = await buildHarness();
    expect(harness).not.toMatch(/[\r\n]/);
    expect(harness).not.toContain('ZodError');
    // Small enough to inject into every learner document.
    expect(harness.length).toBeLessThan(40_000);
  });

  it('uses the shell CSP from the design document', () => {
    expect(SHELL_CSP).toContain("default-src 'none'");
    expect(SHELL_CSP).toContain("connect-src 'none'");
    expect(SHELL_CSP).toContain("frame-src 'none'");
    expect(SHELL_CSP).toContain("form-action 'none'");
    expect(SHELL_CSP).not.toContain('unsafe-eval');
  });
});
