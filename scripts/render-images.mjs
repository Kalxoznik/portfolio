// Renders the link-preview images in headless Chromium at dpr 1:
//   assets/og-image.png   1200x630, from scripts/og-image.html
//   apple-touch-icon.png  180x180, the favicon.svg mark on a square #161514
// Run with `npm run images`. Unbounded loads from Google Fonts, so this needs
// the network; it exits 1 without writing if the font did not load.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDGE = 80;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm install && npx playwright install chromium");
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(ROOT, "scripts/og-image.html")).href, { waitUntil: "load" });
  const og = await page.evaluate(async () => {
    await document.fonts.ready;
    const rects = [...document.querySelectorAll('[data-og="text"] , [data-og="text"] span')].map((el) => {
      // Ink of the text, not the line boxes.
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    });
    return {
      font: document.fonts.check("700 64px Unbounded"),
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  });
  if (!og.font) {
    console.error("Unbounded 700 did not load (offline?). og-image.png was not written.");
    process.exit(1);
  }
  const inside = og.left >= EDGE && og.top >= EDGE && og.right <= 1200 - EDGE && og.bottom <= 630 - EDGE;
  if (!inside) {
    console.error(`Text is closer than ${EDGE}px to an edge: ${JSON.stringify(og)}. og-image.png was not written.`);
    process.exit(1);
  }
  await page.screenshot({ path: path.join(ROOT, "assets/og-image.png") });
  console.log("assets/og-image.png  1200x630");

  // iOS rounds the corners itself, so the square is filled to the edges.
  const svg = await readFile(path.join(ROOT, "favicon.svg"), "utf8");
  const mark = svg.match(/<path[^>]*\/>/)[0];
  await page.setViewportSize({ width: 180, height: 180 });
  await page.setContent(
    `<style>html,body{margin:0;background:#161514}svg{display:block}</style>
     <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 32 32">
       <rect width="32" height="32" fill="#161514"/>
       <g transform="translate(16 16) scale(0.85) translate(-16 -16)">${mark}</g>
     </svg>`
  );
  await page.screenshot({ path: path.join(ROOT, "apple-touch-icon.png"), omitBackground: false });
  console.log("apple-touch-icon.png  180x180");
} finally {
  await browser.close();
}
