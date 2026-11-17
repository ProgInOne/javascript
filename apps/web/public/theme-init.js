// Mirrors src/lib/theme.ts: paints the cached theme on <html data-theme> before first paint.
// 'system' leaves the attribute off (the tokens follow prefers-color-scheme); no cache or an
// unknown value paints the light default (D-078). The server setting is applied after load.
try {
  const t = localStorage.getItem('proginone.theme');
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
  else if (t !== 'system') document.documentElement.dataset.theme = 'light';
} catch {
  // Storage can be unavailable: paint the default.
  document.documentElement.dataset.theme = 'light';
}
