import { startServers } from '../server.mjs';
import { webkit, firefox, chromium } from '@playwright/test';
const s = await startServers({ port: 4361, externalPort: 4362 });
const b = await ({ webkit, firefox, chromium })[process.argv[2] || 'webkit'].launch();
const page = await b.newPage();
await page.goto('http://127.0.0.1:4361/');
await page.waitForSelector('html[data-ready="1"]');
const html = `<!doctype html>
<html><body>
<script>
window.addEventListener("error", e => console.log("raw", e.message, e.lineno, e.colno, String(e.error && e.error.name), e.filename.slice(0, 12)), true);
const src = "let a = 1;\\nnull.x;\\n";
const u = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
const sc = document.createElement("script"); sc.src = u; document.body.appendChild(sc);
const sc2 = document.createElement("script"); sc2.textContent = "let b = 1;\\nnull.y;"; document.body.appendChild(sc2);
</script></body></html>`;
const r = await page.evaluate((h) => window.pg.run({ mode: 'dom', instrument: false, files: [{ path: 'index.html', language: 'html', content: h }], checks: [{ kind: 'waitSettled', maxMs: 300 }] }), html);
console.log(JSON.stringify(r.console.map(e => e.args.map(a => a.v ?? a)), null, 0), JSON.stringify(r.csp));
await b.close(); await s.close();
