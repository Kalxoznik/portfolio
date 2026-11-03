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

  // Experience timeline: each item's line touches the rings with no gap, as in
  // Figma (POR-15). Line and ring are ::before boxes: the item's or mark's rect
  // plus the pseudo's computed top, left, width and height.
  async function timelineChecks(width) {
    const items = await page.evaluate(() =>
      [...document.querySelectorAll(".timeline-item")].map((item) => {
        const mark = item.querySelector(".timeline-mark");
        const line = getComputedStyle(item, "::before");
        const ring = getComputedStyle(mark, "::before");
        const ir = item.getBoundingClientRect();
        const mr = mark.getBoundingClientRect();
        const hasLine = line.content !== "none" && line.content !== "normal";
        const ringTop = mr.top + parseFloat(ring.top);
        return {
          current: item.classList.contains("is-current"),
          hasLine,
          lineTop: ir.top + parseFloat(line.top),
          lineBottom: ir.top + parseFloat(line.top) + parseFloat(line.height),
          lineCenter: ir.left + parseFloat(line.left) + parseFloat(line.width) / 2,
          lineBg: line.backgroundImage,
          ringTop,
          ringBottom: ringTop + parseFloat(ring.height),
          ringCenter: mr.left + parseFloat(ring.left) + parseFloat(ring.width) / 2,
        };
      })
    );
    flag(`timeline items found @${width}`, "≥ 2", items.length, items.length >= 2);
    items.forEach((it, i) => {
      if (!it.hasLine) return;
      const next = items[i + 1];
      const n = i + 1;
      if (next) {
        flag(`timeline ${n}: line bottom ≥ next ring top @${width}`, `≥ ${fmt(next.ringTop)}`, fmt(it.lineBottom), it.lineBottom >= next.ringTop);
      }
      if (!it.current) {
        flag(`timeline ${n}: line top ≤ own ring bottom @${width}`, `≤ ${fmt(it.ringBottom)}`, fmt(it.lineTop), it.lineTop <= it.ringBottom);
      }
      num(`timeline ${n}: line centre x = ring centre @${width}`, it.ringCenter, it.lineCenter, 0.25);
      if (it.current) {
        const ends = /rgb\(169, 157, 122\)\)$/.test(it.lineBg);
        flag(`timeline ${n}: current gradient ends in ring colour @${width}`, "rgb(169, 157, 122)", it.lineBg, ends);
      }
    });
  }

  const m = await page.evaluate(measure);
  const v =(box, key) => (box ? box[key] : null);
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
  await timelineChecks(1920);

  // Experience links: the arrow never wraps away from the link's last word
  // (POR-19). Each paragraph is narrowed from its 1920 width to 240 in 1px
  // steps; at every width the arrow must be on the line of the link's last
  // character (a Range rect) and 3px after it. Transitions are off during the
  // sweep: reduced motion gives every property a 0.01ms transition, which
  // would keep the old width until the next frame.
  const arrowWraps = await page.evaluate(() =>
    [...document.querySelectorAll(".timeline-text")]
      .filter((p) => p.querySelector(".text-link-arrow"))
      .map((p) => {
        const link = p.querySelector(".text-link");
        const arrow = link.querySelector(".text-link-arrow");
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        let last = null;
        while (walker.nextNode()) if (walker.currentNode.data.trim()) last = walker.currentNode;
        const end = last.data.trimEnd().length;
        const range = document.createRange();
        range.setStart(last, end - 1);
        range.setEnd(last, end);
        // The character after the link (a comma) must stay on the arrow's line
        // too. A word joiner before it is skipped; a space may wrap, so no check.
        let after = null;
        const next = link.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          const i = next.data.search(/[^⁠]/);
          if (i >= 0 && !/\s/.test(next.data[i])) {
            after = document.createRange();
            after.setStart(next, i);
            after.setEnd(next, i + 1);
          }
        }
        const full = Math.floor(p.getBoundingClientRect().width);
        const bad = [];
        const badAfter = [];
        p.style.transition = "none";
        for (let w = full; w >= 240; w--) {
          p.style.width = `${w}px`;
          const ch = range.getBoundingClientRect();
          const ar = arrow.getBoundingClientRect();
          const mid = (ar.top + ar.bottom) / 2;
          const sameLine = mid > ch.top && mid < ch.bottom;
          const gap = ar.left - ch.right;
          if (!sameLine || Math.abs(gap - 3) > 0.5) bad.push(w);
          if (after) {
            const nx = after.getBoundingClientRect();
            if (!(mid > nx.top && mid < nx.bottom)) badAfter.push(w);
          }
        }
        p.style.width = "";
        p.style.transition = "";
        return { name: link.textContent.trim(), full, bad, after: after && after.toString(), badAfter };
      })
  );
  flag("experience links with an arrow", "3", arrowWraps.length, arrowWraps.length === 3);
  for (const a of arrowWraps) {
    const shown = a.bad.length ? `${a.bad.length} (${a.bad.slice(0, 3).join(", ")}…)` : "0";
    flag(`"${a.name}" arrow on last char's line, 3px after, widths ${a.full}→240`, "0 failing", shown, a.bad.length === 0);
    if (a.after) {
      const shownAfter = a.badAfter.length ? `${a.badAfter.length} (${a.badAfter.slice(0, 3).join(", ")}…)` : "0";
      flag(`"${a.name}" "${a.after}" after the link on the arrow's line, widths ${a.full}→240`, "0 failing", shownAfter, a.badAfter.length === 0);
    }
  }
  // Hovered, the arrow takes the accent colour with the text. Read after
  // 50ms, once the (reduced-motion, 0.01ms) colour transition is over.
  await page.hover(".timeline-text .text-link");
  await page.waitForTimeout(50);
  const hoverStroke = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const path = document.querySelector(".timeline-text .text-link-arrow path");
    return { accent, stroke: getComputedStyle(path).stroke };
  });
  flag("hovered link: arrow stroke = accent", hoverStroke.accent, hoverStroke.stroke, hoverStroke.stroke === hoverStroke.accent);
  await page.mouse.move(0, 0);

  // The header is transparent until the hero title's top reaches its bottom,
  // then fills with the plain background, no dots, at once (POR-13). Read two
  // frames after the scroll: a fade would still be on its way there.
  const CLEAR = "rgba(0, 0, 0, 0) / none";
  const SOLID = "rgb(22, 21, 20) / none";
  async function headerBgAt(y) {
    return page.evaluate(async (y) => {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cs = getComputedStyle(document.querySelector('[data-check="header"]'));
      return `${cs.backgroundColor} / ${cs.backgroundImage}`;
    }, y);
  }
  const top0Bg = await headerBgAt(0);
  flag("header transparent at scrollY 0", CLEAR, top0Bg, top0Bg === CLEAR);
  const solidAt = m.heroTitle && m.header ? Math.round(m.heroTitle.top - (m.header.top + m.header.height)) : null;
  if (solidAt == null) {
    flag("header fill threshold (title top − header bottom)", "measured", "missing", false);
  } else {
    const beforeBg = await headerBgAt(solidAt - 4);
    flag(`header transparent 4px before fill (scrollY ${solidAt - 4})`, CLEAR, beforeBg, beforeBg === CLEAR);
    const afterBg = await headerBgAt(solidAt + 4);
    flag(`header filled 4px after fill (scrollY ${solidAt + 4})`, SOLID, afterBg, afterBg === SOLID);
    // The check runs reduced-motion, which cuts every transition anyway, so
    // prove there is no fade with motion on: no in-between colour either way.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await headerBgAt(0);
    const instantOn = await headerBgAt(solidAt + 4);
    flag("motion on: header filled on the next frame", SOLID, instantOn, instantOn === SOLID);
    const instantOff = await headerBgAt(0);
    flag("motion on: header clear on the next frame", CLEAR, instantOff, instantOff === CLEAR);
    await page.emulateMedia({ reducedMotion: "reduce" });
  }

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
  const caseBg = await headerBgAt(1080);
  flag("header filled at first case (scrollY 1080)", SOLID, caseBg, caseBg === SOLID);
  const backBg = await headerBgAt(0);
  flag("header transparent again back at top", CLEAR, backBg, backBg === CLEAR);

  // Under 1300 the nav folds into a MENU button, which must clear the centred
  // logo by the 26px nav gap; from 1300 the full nav row clears it (POR-12).
  // Edges: the logo's text via a Range, the button's or nav's border box.
  // Scrolled to the work section, so "Recent Work" is bold, its widest state;
  // 300ms lets the nav's visibility transition finish after the resize.
  async function headerGap(width, height = 900) {
    await page.setViewportSize({ width, height });
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
      const logoText = range.getBoundingClientRect();
      const logoCs = getComputedStyle(logo);
      const buttonRect = button.getBoundingClientRect();
      const logoRect = logo.getBoundingClientRect();
      const toggleRect = document.querySelector(".theme-toggle").getBoundingClientRect();
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${logoCs.fontWeight} ${logoCs.fontSize} ${logoCs.fontFamily}`;
      return {
        menu,
        navVisible: getComputedStyle(nav).visibility === "visible",
        gap: logoText.left - left.getBoundingClientRect().right,
        // Viewport coordinates, the header being sticky.
        headerHeight: document.querySelector('[data-check="header"]').getBoundingClientRect().height,
        logoTop: logo.getBoundingClientRect().top + parseFloat(logoCs.borderTopWidth) + parseFloat(logoCs.paddingTop),
        buttonTop: buttonRect.top,
        logoCapHeight: ctx.measureText("M").actualBoundingBoxAscent,
        logoCenter: (logoText.left + logoText.right) / 2,
        logoRight: logoText.right,
        halfWidth: document.documentElement.clientWidth / 2,
        toggleLeft: toggleRect.left,
        buttonMid: (buttonRect.top + buttonRect.bottom) / 2,
        logoMid: (logoRect.top + logoRect.bottom) / 2,
        toggleMid: (toggleRect.top + toggleRect.bottom) / 2,
        labelWidth: document.querySelector(".menu-label").getBoundingClientRect().width,
      };
    });
  }
  const menuShown = (g) => g.menu && !g.navVisible;
  for (const width of [1081, 1201, 1299, 1080, 721]) {
    const g = await headerGap(width);
    flag(`menu button shown, nav hidden @${width}`, "yes", menuShown(g) ? "yes" : "no", menuShown(g));
    flag(`menu→logo gap ≥ 26 @${width}`, "≥ 26", fmt(g.gap), g.gap >= 26);
    flag(`menu label hidden, width ≤ 1 @${width}`, "≤ 1", fmt(g.labelWidth), g.labelWidth <= 1);
    // Across 1080 the header must not jump: same row as at 1081.
    if (width === 1080) {
      num("header height @1080 (viewport)", 118, g.headerHeight);
      num("logo top @1080 (text, viewport)", 54, g.logoTop);
    }
    if (width === 721) {
      num("header height @721 (viewport)", 118, g.headerHeight);
      num("logo cap height @721 (M ink)", 19.5, g.logoCapHeight, 0.5);
    }
  }
  // ≤720: the same one row; the logo is 16px and centred on the screen, and
  // the button shows only its icon at every width (POR-16).
  for (const [width, height] of [[720, 900], [481, 900], [480, 900], [375, 812]]) {
    const g = await headerGap(width, height);
    flag(`menu button shown, nav hidden @${width}`, "yes", menuShown(g) ? "yes" : "no", menuShown(g));
    const offRow = Math.max(Math.abs(g.buttonMid - g.logoMid), Math.abs(g.toggleMid - g.logoMid));
    flag(`button, logo, toggle centres in one row @${width}`, "±1", fmt(offRow), offRow <= 1);
    num(`logo top @${width} (text, viewport)`, 54, g.logoTop);
    flag(`menu→logo gap ≥ 26 @${width}`, "≥ 26", fmt(g.gap), g.gap >= 26);
    flag(`menu label hidden, width ≤ 1 @${width}`, "≤ 1", fmt(g.labelWidth), g.labelWidth <= 1);
    if (width !== 720 && width !== 375) continue;
    num(`header height @${width} (viewport)`, 118, g.headerHeight);
    num(`logo cap height @${width} (M ink)`, 12, g.logoCapHeight, 0.5);
    num(`logo text centre = clientWidth / 2 @${width}`, g.halfWidth, g.logoCenter, 1);
    if (width === 375) {
      const toToggle = g.toggleLeft - g.logoRight;
      flag("logo→theme toggle gap ≥ 26 @375", "≥ 26", fmt(toToggle), toToggle >= 26);
    }
  }
  // Still 375: the panel opens below the button and stays on screen.
  const phoneMenu = await page.evaluate(async () => {
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const button = document.querySelector('[data-check="menu-toggle"]');
    const nav = document.querySelector('[data-check="nav"]');
    const state = () => `${button.getAttribute("aria-expanded")}/${getComputedStyle(nav).visibility}`;
    button.click();
    await frames();
    const opened = state();
    const panel = nav.getBoundingClientRect();
    const buttonBottom = button.getBoundingClientRect().bottom;
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await new Promise((r) => setTimeout(r, 300));
    return { opened, panelTop: panel.top, panelRight: panel.right, buttonBottom, overflow, closed: state() };
  });
  flag("menu opens on click @375", "true/visible", phoneMenu.opened, phoneMenu.opened === "true/visible");
  flag("panel top below button @375", `> ${fmt(phoneMenu.buttonBottom)}`, fmt(phoneMenu.panelTop), phoneMenu.panelTop > phoneMenu.buttonBottom);
  flag("panel right edge ≤ 375", "≤ 375", fmt(phoneMenu.panelRight), phoneMenu.panelRight <= 375);
  flag("no horizontal scroll, menu open @375", "0", phoneMenu.overflow, phoneMenu.overflow <= 0);
  flag("menu closes on Escape @375", "false/hidden", phoneMenu.closed, phoneMenu.closed === "false/hidden");
  await headerGap(1299);
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
  // Resizing into the range must hide the nav at once, with no fade-out:
  // two frames after 1300 → 1299, no 300ms wait.
  await page.setViewportSize({ width: 1299, height: 900 });
  const resizedNav = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return getComputedStyle(document.querySelector('[data-check="nav"]')).visibility;
  });
  flag("nav hidden at once on resize 1300→1299", "hidden", resizedNav, resizedNav === "hidden");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const over375 = await page.evaluate(overflowX);
  flag("no horizontal scroll @375", "0", over375, over375 <= 0);
  await timelineChecks(375);
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
