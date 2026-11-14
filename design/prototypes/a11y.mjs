// axe-core 접근성 자동 검사 (WCAG 2.2 A/AA 규칙)
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const axeSource = (await import("node:fs")).readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ["dashboard.html", "course.html", "learn-read.html", "learn-practice.html"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let total = 0;
for (const f of FILES) {
  for (const d of ["a", "b", "c"]) {
    for (const t of ["light", "dark"]) {
      await page.goto(`${pathToFileURL(path.join(here, f)).href}?d=${d}&t=${t}&shot=1`, { waitUntil: "networkidle" });
      await page.addScriptTag({ content: axeSource });
      const res = await page.evaluate(async () =>
        (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") })),
      );
      const serious = res.filter((v) => ["critical", "serious"].includes(v.impact));
      total += serious.length;
      console.log(`${f} ${d}/${t}: 위반 ${res.length}건 (심각·중대 ${serious.length})${res.length ? "\n  " + res.map((v) => `${v.impact} ${v.id} ×${v.n} e.g. ${v.sample}`).join("\n  ") : ""}`);
    }
  }
}
await browser.close();
process.exitCode = total ? 1 : 0;
