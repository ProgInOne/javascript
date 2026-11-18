/**
 * Stale build detection. Routes are code-split, so a page loaded before `pnpm build` replaced
 * `dist/` asks for chunk files that no longer exist the next time it opens a new screen. Browsers
 * word that failure differently; these patterns cover Chromium, Firefox and WebKit.
 */
const CHUNK_LOAD_FAILURE = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

/** True when `error` is a failed load of a build chunk (the page is older than the build). */
export function isStaleBuildError(error: unknown): boolean {
  const message =
    typeof error === 'object' && error !== null && typeof (error as Error).message === 'string'
      ? (error as Error).message
      : '';
  return CHUNK_LOAD_FAILURE.some((pattern) => pattern.test(message));
}

const RELOAD_KEY = 'proginone:stale-build-reload';
/** Reload at most once in this window so a broken build cannot loop. */
const RELOAD_WINDOW_MS = 30_000;

interface ReloadDeps {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload?: () => void;
}

/**
 * Reloads the page once to pick up the new build. Returns false (and does nothing) when it already
 * reloaded within the last 30 s, or when session storage is unavailable, so the caller shows the
 * error with a manual reload button instead.
 */
export function reloadForNewBuild(deps: ReloadDeps = {}): boolean {
  const now = deps.now ?? Date.now;
  let storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  try {
    storage = deps.storage === undefined ? window.sessionStorage : deps.storage;
  } catch {
    storage = null;
  }
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
    if (now() - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now()));
  } catch {
    return false;
  }
  (
    deps.reload ??
    (() => {
      window.location.reload();
    })
  )();
  return true;
}

/** Vite fires `vite:preloadError` when a chunk preload fails: reload once instead of failing. */
export function installStaleBuildReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
