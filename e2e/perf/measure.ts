import type { Page } from '@playwright/test';

/**
 * In-page timing for the performance check (docs/reviews/2026-11-16-m7-performance.md).
 *
 * Durations are measured inside the page, not from the test process, so Playwright's own
 * round trips do not count: the start is the `click`/`keydown` event (captured on `window`
 * before the app sees it) or the navigation start, and the end is the time inside the first
 * animation-frame callback in which the expected element is in the document (just before that
 * frame paints). Frames come every ~16 ms, so a result is at most one frame late.
 */

/** What "the screen is ready" means for one measurement. */
export interface ReadySpec {
  /** CSS selector of the element that must appear. */
  selector: string;
  /** Its text must match this pattern (`RegExp` source, case-sensitive). */
  text?: string;
  /** Only elements that were not in the document when measuring started count. */
  fresh?: boolean;
  /** Also wait until no loading placeholder (`.pi-skeleton`, `[aria-busy=true]`) is left. */
  settled?: boolean;
}

interface PerfWindow {
  __perfLastInput: number;
  __perfPending: Promise<number> | undefined;
  __perfWait: (spec: ReadySpec) => Promise<number>;
  __perfFirstReady: number | undefined;
  __perfFrames: { maxGap: number; last: number; running: boolean };
}

/**
 * Installed before any page script: records the last user input and provides the frame poller.
 * `firstReady` also starts polling right away for the first screen of a page load.
 */
function installPerfHooks(firstReady: ReadySpec | null) {
  const w = window as unknown as PerfWindow;
  w.__perfLastInput = Number.NaN;
  const mark = () => {
    w.__perfLastInput = performance.now();
  };
  window.addEventListener('click', mark, true);
  window.addEventListener('keydown', mark, true);

  const matches = (spec: ReadySpec, old: Set<Element> | null) => {
    const pattern = spec.text === undefined ? null : new RegExp(spec.text);
    const found = [...document.querySelectorAll(spec.selector)].some(
      (el) =>
        !(old?.has(el) ?? false) &&
        (pattern === null || pattern.test(el.textContent)) &&
        el.getClientRects().length > 0,
    );
    if (!found) return false;
    if (!spec.settled) return true;
    return document.querySelector('.pi-skeleton, [aria-busy="true"]') === null;
  };

  w.__perfWait = (spec) => {
    const old = spec.fresh ? new Set(document.querySelectorAll(spec.selector)) : null;
    return new Promise<number>((resolve) => {
      const tick = () => {
        if (matches(spec, old)) resolve(performance.now());
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };

  if (firstReady) {
    const tick = () => {
      if (matches(firstReady, null)) w.__perfFirstReady = performance.now();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

export async function addPerfHooks(page: Page, firstReady: ReadySpec | null = null) {
  await page.addInitScript(installPerfHooks, firstReady);
}

/**
 * Runs `action` (a click or key press) and returns the milliseconds from that input event to the
 * first frame in which `ready` holds.
 */
export async function timeInteraction(
  page: Page,
  ready: ReadySpec,
  action: () => Promise<void>,
  timeoutMs = 15_000,
): Promise<number> {
  await page.evaluate((spec) => {
    const w = window as unknown as PerfWindow;
    w.__perfLastInput = Number.NaN;
    w.__perfPending = w.__perfWait(spec);
  }, ready);
  await action();
  const [end, start] = await page.evaluate(async (timeout) => {
    const w = window as unknown as PerfWindow;
    const timer = new Promise<number>((resolve) =>
      setTimeout(() => {
        resolve(Number.NaN);
      }, timeout),
    );
    const t = await Promise.race([w.__perfPending ?? timer, timer]);
    return [t, w.__perfLastInput];
  }, timeoutMs);
  if (Number.isNaN(end))
    throw new Error(`not ready within ${String(timeoutMs)} ms: ${ready.selector}`);
  if (Number.isNaN(start)) throw new Error('the action did not produce a click or key event');
  return end - start;
}

/** Milliseconds from navigation start to the first frame with the `firstReady` element. */
export async function firstReadyTime(page: Page, timeoutMs = 15_000): Promise<number> {
  await page.waitForFunction(
    () => (window as unknown as PerfWindow).__perfFirstReady !== undefined,
    null,
    { timeout: timeoutMs },
  );
  return page.evaluate(() => (window as unknown as PerfWindow).__perfFirstReady ?? Number.NaN);
}

/** Paint and navigation timings of the current document, in ms from navigation start. */
export function navigationTimings(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const js = resources.filter((r) => r.name.endsWith('.js'));
    return {
      domContentLoaded: nav?.domContentLoadedEventEnd ?? Number.NaN,
      load: nav?.loadEventEnd ?? Number.NaN,
      firstContentfulPaint: fcp?.startTime ?? Number.NaN,
      jsFiles: js.length,
      jsBytes: js.reduce((sum, r) => sum + r.decodedBodySize, 0),
    };
  });
}

/** Starts recording the longest gap between animation frames of the app document. */
export async function startFrameMonitor(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as PerfWindow;
    w.__perfFrames = { maxGap: 0, last: performance.now(), running: true };
    const tick = (t: number) => {
      const m = w.__perfFrames;
      if (!m.running) return;
      m.maxGap = Math.max(m.maxGap, t - m.last);
      m.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function stopFrameMonitor(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (window as unknown as PerfWindow).__perfFrames;
    m.running = false;
    return m.maxGap;
  });
}

/** Summary statistics of samples (ms). p75 uses the nearest-rank method. */
export function summarize(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  const round = (n: number | undefined) => Math.round(n ?? Number.NaN);
  return {
    n: sorted.length,
    min: round(sorted[0]),
    median: round(rank(0.5)),
    p75: round(rank(0.75)),
    max: round(sorted.at(-1)),
  };
}

/**
 * `PERF_CPU_THROTTLE=4` slows the page's CPU down 4× (Chromium DevTools emulation), to see how
 * much margin a slower computer would have. Network stays local and unthrottled.
 */
export async function applyCpuThrottle(page: Page) {
  const rate = Number(process.env['PERF_CPU_THROTTLE'] ?? 1);
  if (!(rate > 1)) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}
