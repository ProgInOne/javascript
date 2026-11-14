// 프로토타입 스크린샷 캡처
// 사용법: node capture.mjs [화면이름 ...]   (예: node capture.mjs dashboard)
// 출력: screenshots/<화면>-<시안>-<테마>-<폭>.png
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "screenshots");
fs.mkdirSync(out, { recursive: true });

const SCREENS = [
  { name: "index", file: "index.html", widths: [1440], fullPage: true, directions: ["a"] },
  { name: "dashboard", file: "dashboard.html", widths: [1440] },
  { name: "course", file: "course.html", widths: [1440] },
  { name: "learn-read", file: "learn-read.html", widths: [1440, 1280, 1024], scrollTo: [["s2", "#sec-let"], ["s3", "#sec-const"]] },
  { name: "learn-practice", file: "learn-practice.html", widths: [1440, 1280, 1024] },
];
const DIRECTIONS = ["a", "b", "c"];
const THEMES = ["light", "dark"];
const HEIGHT = { 1440: 900, 1280: 800, 1024: 768 };

const only = process.argv.slice(2);
const targets = only.length ? SCREENS.filter((s) => only.includes(s.name)) : SCREENS;

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce", locale: "ko-KR" });
const page = await context.newPage();
let n = 0;
for (const s of targets) {
  for (const w of s.widths) {
    await page.setViewportSize({ width: w, height: HEIGHT[w] });
    for (const d of s.directions || DIRECTIONS) {
      for (const t of THEMES) {
        const url = `${pathToFileURL(path.join(here, s.file)).href}?d=${d}&t=${t}&shot=1`;
        await page.goto(url, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(out, `${s.name}-${d}-${t}-${w}.png`);
        await page.screenshot({ path: file, fullPage: !!s.fullPage });
        n++;
        if (s.scrollTo && w === 1440) {
          // 스크롤 영역 안쪽(예제·흔한 실수·확인 문제)도 촬영
          for (const [suffix, sel] of s.scrollTo) {
            await page.evaluate((q) => { const el = document.querySelector(q); el.scrollIntoView({ block: 'start' }); }, sel);
            await page.screenshot({ path: path.join(out, `${s.name}-${suffix}-${d}-${t}-${w}.png`) });
            n++;
          }
        }
      }
    }
  }
}
await browser.close();
console.log(`${n}장 저장: ${path.relative(process.cwd(), out)}`);
