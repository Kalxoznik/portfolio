// Layout check: opens index.html in headless Chromium at 1920x1080 (dark theme)
// and compares measured positions with the Figma "dark" page
// (file JtEfXEmJLKl2HL0BHe0Jie, page 31:5). Exits 1 if any check fails.
//
// Positions are page coordinates (rect + scrollY). Rows marked "text" use the
// top of the content box (rect.top + border-top + padding-top), since Figma
// places the text box, not the element's padding.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOLERANCE = 3;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm install && npx playwright install chromium");
  process.exit(1);
}

// Measured in the page. `box` is the outer border box, `text` the content box.
function measure() {
  const one = (name, index = 0) => {
    const el = document.querySelectorAll(`[data-check="${name}"]`)[index];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = rect.top + window.scrollY;
    return {
      top,
      left: rect.left + window.scrollX,
      height: rect.height,
      textTop: top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop),
      textLeft: rect.left + window.scrollX + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
    };
  };
  const fontLoaded = (family, weight) =>
    [...document.fonts].some(
      (f) => f.family.replace(/["']/g, "") === family && String(f.weight) === weight && f.status === "loaded"
    );
  // Cap height of the logo: ink ascent of "M" in the logo's computed font.
  const logoCapHeight = (() => {
    const el = document.querySelector('[data-check="logo"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText("M").actualBoundingBoxAscent;
  })();
  return {
    header: one("header"),
    logoCapHeight,
    logo: one("logo"),
    nav: one("nav-first"),
    heroTitle: one("hero-title"),
    heroLead: one("hero-lead"),
    case1Title: one("case-title", 0),
    case1Carousel: one("case-carousel", 0),
    case1Dots: one("case-dots", 0),
    case2Title: one("case-title", 1),
    about: one("about"),
    aboutTitle: one("about-title"),
    timelineDate: one("timeline-date"),
    footer: one("footer"),
    contactLabel: one("contact-label"),
    contactEmail: one("contact-email"),
    theme: document.documentElement.getAttribute("data-theme"),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    unbounded700: fontLoaded("Unbounded", "700"),
    inter400: fontLoaded("Inter", "400"),
    scrollY: window.scrollY,
  };
}

function overflowX() {
  return document.documentElement.scrollWidth - document.documentElement.clientWidth;
}

const rows = [];
let failed = 0;

const fmt = (n) => (n == null || !Number.isFinite(n) ? "missing" : String(Math.round(n * 100) / 100));

// `expected` is null when it is relative to an element that is missing.
function num(name, expected, actual, tolerance = TOLERANCE) {
  const ok = expected != null && actual != null && Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  rows.push([name, fmt(expected), fmt(actual), ok ? "OK" : "FAIL"]);
}

function flag(name, expected, actual, ok) {
  if (!ok) failed++;
  rows.push([name, String(expected), String(actual), ok ? "OK" : "FAIL"]);
}

const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch();

try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const m = await page.evaluate(measure);
  const v = (box, key) => (box ? box[key] : null);
  const plus = (box, key, add) => (box ? box[key] + add : null);

  flag("theme: html[data-theme]", "dark", m.theme, m.theme === "dark");
  flag("font: Unbounded 700 loaded", "yes", m.unbounded700 ? "yes" : "no", m.unbounded700);
  flag("font: Inter 400 loaded", "yes", m.inter400 ? "yes" : "no", m.inter400);
  flag("scrolled to top (scrollY)", "0", m.scrollY, m.scrollY === 0);
  flag("body background", "rgb(22, 21, 20)", m.bodyBg, m.bodyBg === "rgb(22, 21, 20)");

  // +6: the header row sits 6px below Figma, as Max Shakurov asked (POR-9).
  // Figma: header 118, logo 48, nav 52.
  num("header height", 118, v(m.header, "height"));
  num("logo MAXSHAKUROV top (text)", 54, v(m.logo, "textTop"));
  // 19.5: Max Shakurov's Photoshop overlay is at 2x and the Figma logo M there is 39 px.
  num("logo cap height (M ink)", 19.5, m.logoCapHeight, 0.5);
  num("nav text top (text)", 58, v(m.nav, "textTop"));
  num("nav left x (text)", 77, v(m.nav, "textLeft"));
  num("hero title top (text)", 364, v(m.heroTitle, "textTop"));
  num("hero subline top (text)", 633, v(m.heroLead, "textTop"));
  num("case 1 title top (text)", 1198, v(m.case1Title, "textTop"));
  num("case 1 carousel top", 1345, v(m.case1Carousel, "top"));
  num("case 1 dots top", 2104, v(m.case1Dots, "top"));
  num("case 2 title top (text)", 2278, v(m.case2Title, "textTop"));
  num("Experience H2 top = about + 118 (text)", plus(m.about, "top", 118), v(m.aboutTitle, "textTop"));
  num("first timeline date = H2 + 100 (text)", plus(m.aboutTitle, "textTop", 100), v(m.timelineDate, "textTop"));
  num("footer height", 1080, v(m.footer, "height"));
  num("MESSAGE ME = footer + 464 (text)", plus(m.footer, "top", 464), v(m.contactLabel, "textTop"));
  num("email = footer + 508 (text)", plus(m.footer, "top", 508), v(m.contactEmail, "textTop"));

  const over1920 = await page.evaluate(overflowX);
  flag("no horizontal scroll @1920", "0", over1920, over1920 <= 0);

  // Scrolled to the first case: the sticky header has not moved, the row is
  // still 6px below Figma. Viewport coordinates (page position minus scrollY).
  await page.evaluate(async () => {
    window.scrollTo(0, 1080);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const s = await page.evaluate(measure);
  const vp = (box, key) => (box ? box[key] - s.scrollY : null);
  flag("scrolled to first case (scrollY)", "1080", s.scrollY, s.scrollY === 1080);
  num("scrolled: header bottom (viewport)", 118, s.header ? s.header.top + s.header.height - s.scrollY : null);
  num("scrolled: logo top (text, viewport)", 54, vp(s.logo, "textTop"));
  num("scrolled: nav text top (text, viewport)", 58, vp(s.nav, "textTop"));

  // 1081–1299: the nav folds into a MENU button, which must clear the centred
  // logo by the 26px nav gap; from 1300 the full nav row clears it (POR-12).
  // Edges: the logo's text via a Range, the button's or nav's border box.
  // Scrolled to the work section, so "Recent Work" is bold, its widest state;
  // 300ms lets the nav's visibility transition finish after the resize.
  async function headerGap(width) {
    await page.setViewportSize({ width, height: 900 });
    return page.evaluate(async () => {
      window.scrollTo(0, document.getElementById("work").offsetTop);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 300));
      const button = document.querySelector('[data-check="menu-toggle"]');
      const nav = document.querySelector('[data-check="nav"]');
      const logo = document.querySelector('[data-check="logo"]');
      const range = document.createRange();
      range.selectNodeContents(logo);
      const menu = getComputedStyle(button).display !== "none";
      const left = menu ? button : nav;
      return {
        menu,
        navVisible: getComputedStyle(nav).visibility === "visible",
        gap: range.getBoundingClientRect().left - left.getBoundingClientRect().right,
      };
    });
  }
  for (const width of [1081, 1201, 1299]) {
    const g = await headerGap(width);
    flag(`menu button shown, nav hidden @${width}`, "yes", g.menu && !g.navVisible ? "yes" : "no", g.menu && !g.navVisible);
    flag(`menu→logo gap ≥ 26 @${width}`, "≥ 26", fmt(g.gap), g.gap >= 26);
  }
  const menuStates = await page.evaluate(async () => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const button = document.querySelector('[data-check="menu-toggle"]');
    const nav = document.querySelector('[data-check="nav"]');
    const state = () => `${button.getAttribute("aria-expanded")}/${getComputedStyle(nav).visibility}`;
    button.click();
    await frames();
    const opened = state();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((r) => setTimeout(r, 300));
    return { opened, closed: state() };
  });
  flag("menu opens on click @1299", "true/visible", menuStates.opened, menuStates.opened === "true/visible");
  flag("menu closes on Escape @1299", "false/hidden", menuStates.closed, menuStates.closed === "false/hidden");
  const g1300 = await headerGap(1300);
  flag("nav row shown, no menu button @1300", "yes", !g1300.menu && g1300.navVisible ? "yes" : "no", !g1300.menu && g1300.navVisible);
  flag("nav→logo gap ≥ 26 @1300", "≥ 26", fmt(g1300.gap), g1300.gap >= 26);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const over375 = await page.evaluate(overflowX);
  flag("no horizontal scroll @375", "0", over375, over375 <= 0);
} finally {
  await browser.close();
  server.close();
}

const header = ["check", "expected", "actual", "result"];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
console.log(`Layout check: 1920x1080, dark theme, tolerance ±${TOLERANCE}px\n`);
console.log(line(header));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const r of rows) console.log(line(r));
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
