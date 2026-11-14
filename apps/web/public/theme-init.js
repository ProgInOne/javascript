// Mirrors src/lib/theme.ts: the cached theme ('light' | 'dark') goes on <html data-theme>.
try {
  const t = localStorage.getItem('proginone.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {
  // Storage can be unavailable; the server setting is applied after load.
}
