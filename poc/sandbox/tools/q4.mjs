import { startServers } from '../server.mjs';
import { chromium, firefox, webkit } from '@playwright/test';
const s = await startServers({ port: 4341, externalPort: 4342 });
const which = process.argv[2] || 'chromium';
const variant = process.argv[3] || 'default';
const opts = {
  default: {},
  'ff-fission': { firefoxUserPrefs: { 'fission.autostart': true, 'fission.webContentIsolationStrategy': 1 } },
  'chromium-newheadless': { channel: 'chromium' },
  'enable-isolate': { args: ['--enable-features=IsolateSandboxedIframes'] },
  'chrome-stable': { channel: 'chrome' },
  'chrome-stable-trials': { channel: 'chrome', ignoreDefaultArgs: ['--disable-field-trial-config'] },
  'chrome-stable-isolate': { channel: 'chrome', args: ['--enable-features=IsolateSandboxedIframes'] },
  'headed-chrome-isolate': { channel: 'chrome', headless: false, args: ['--enable-features=IsolateSandboxedIframes'] },
}[variant];
console.log('variant', variant, JSON.stringify(opts));
const browser = await ({ chromium, firefox, webkit })[which].launch(opts);
console.log('version', browser.version());
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4341/' + (process.argv[4] === 'cross-site' ? '?shellOrigin=http://localhost:4341' : ''));
await page.waitForSelector('html[data-ready="1"]');
const t = Date.now();
// fire and poll, so we can see whether the app thread is frozen
await page.evaluate(() => { window.__r = null; window.pg.run({ mode: 'dom', files: [{ path: 'index.html', language: 'html', content: '<!doctype html><script>while(true){}</script>' }], instrument: false, limits: { maxDurationMs: 2000 } }).then(r => window.__r = r); });
for (let i = 0; i < 12; i++) {
  const t0 = Date.now();
  const v = await Promise.race([page.evaluate(() => ({ r: window.__r && { status: window.__r.status, wd: window.__r.watchdog, host: window.__r.host }, mon: window.pg.monitor() })), new Promise(r => setTimeout(() => r('EVAL-TIMEOUT'), 2000))]);
  console.log(((Date.now() - t) / 1000).toFixed(1) + 's', 'evalLatency', Date.now() - t0, JSON.stringify(v));
  if (v !== 'EVAL-TIMEOUT' && v.r) break;
  await new Promise(r => setTimeout(r, 500));
}
await browser.close(); await s.close();
